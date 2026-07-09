import type {
  AppPermissionMode,
  ApprovalGrant,
  PermissionAction,
  PermissionRule,
  RiskLevel,
  SpokSettings,
} from "@/lib/settings/types";
import {
  formatCommandPreview,
  matchCommandPattern,
  resolveCommandProfile,
} from "./command-profiles";
import {
  isDeniedSecretPath,
  matchDenyGlob,
  normalizeRepoRelativePath,
} from "./secrets";
import { isTrustedWorkspacePath } from "./workspace-trust";

export type PolicyDecisionKind = "allow" | "deny" | "ask";

export type PolicyDecision = {
  decision: PolicyDecisionKind;
  reason: string;
  policy: string;
  risk: RiskLevel;
  profile?: string;
  matchedRuleId?: string;
  /** When ask, client should show approval UI */
  requiresApproval: boolean;
};

export type PolicyContext = {
  settings: SpokSettings;
  action: PermissionAction;
  sessionId?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  path?: string;
  /** Server-side grants (allow once/always) */
  grants?: ApprovalGrant[];
  /** Fingerprint that was just approved via one-shot token */
  approvedFingerprint?: string;
};

function enabledRules(settings: SpokSettings): PermissionRule[] {
  return (settings.rules ?? []).filter((r) => r.enabled !== false);
}

function commandBasename(command: string): string {
  return (command.replace(/\\/g, "/").split("/").pop() || command).toLowerCase();
}

function ruleMatches(
  rule: PermissionRule,
  ctx: PolicyContext,
  profileId?: string
): boolean {
  if (!rule.actions.includes(ctx.action)) return false;

  if (rule.profile) {
    if (!profileId || rule.profile !== profileId) return false;
  }

  if (rule.command) {
    if (!ctx.command || !matchCommandPattern(ctx.command, rule.command)) {
      return false;
    }
  }

  if (rule.path) {
    if (!ctx.path) return false;
    const p = normalizeRepoRelativePath(ctx.path);
    if (!matchDenyGlob(p, rule.path) && !matchPathPattern(p, rule.path)) {
      return false;
    }
  }

  return true;
}

/** Lightweight path pattern match for permission rules (glob-ish). */
function matchPathPattern(filePath: string, pattern: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  const pat = pattern.replace(/\\/g, "/").toLowerCase();
  if (pat === p) return true;
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return p === prefix || p.startsWith(prefix + "/");
  }
  if (pat.includes("*")) {
    const re = new RegExp(
      "^" +
        pat
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*") +
        "$"
    );
    return re.test(p);
  }
  return p.endsWith("/" + pat) || p.includes("/" + pat + "/") || p.endsWith(pat);
}

/**
 * Stable fingerprint for approval grants.
 * Uses command basename so path vs bare name still match.
 * includeArgs=false is used for allow_always command-scoped grants.
 */
export function actionFingerprint(
  ctx: {
    action: PermissionAction;
    command?: string;
    args?: string[];
    cwd?: string;
    path?: string;
  },
  opts?: { includeArgs?: boolean }
): string {
  const includeArgs = opts?.includeArgs !== false;
  const cmd = ctx.command ? commandBasename(ctx.command) : "";
  const cwd = (ctx.cwd ?? "").replace(/\\/g, "/").toLowerCase();
  const pathPart = (ctx.path ?? "").replace(/\\/g, "/").toLowerCase();
  const argsPart = includeArgs ? (ctx.args ?? []).join("\0") : "*";
  return [ctx.action, cmd, argsPart, cwd, pathPart].join("|");
}

function pathsEqual(a: string, b: string): boolean {
  return (
    a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
  );
}

function findGrant(
  grants: ApprovalGrant[] | undefined,
  ctx: PolicyContext
): ApprovalGrant | undefined {
  if (!grants?.length) return undefined;
  const exactFp = actionFingerprint(ctx, { includeArgs: true });
  const cmdFp = actionFingerprint(ctx, { includeArgs: false });
  const now = Date.now();
  const cmdBase = ctx.command ? commandBasename(ctx.command) : "";

  return grants.find((g) => {
    if (g.expiresAt && g.expiresAt < now) return false;

    // Exact fingerprint (allow_once / precise allow_always)
    if (g.fingerprint === exactFp || g.fingerprint === cmdFp) return true;

    // allow_always: same action + same command basename + same cwd (any args)
    if (
      g.decision === "allow_always" &&
      g.action === ctx.action &&
      g.command &&
      cmdBase &&
      commandBasename(g.command) === cmdBase &&
      g.cwd &&
      ctx.cwd &&
      pathsEqual(g.cwd, ctx.cwd)
    ) {
      return true;
    }

    // Never match on profile alone — that would approve every custom binary.
    return false;
  });
}

/**
 * Evaluate permission policy for a privileged action.
 * Deny rules always win. Explicit allow rules and grants satisfy ask.
 */
export function evaluatePolicy(ctx: PolicyContext): PolicyDecision {
  const mode: AppPermissionMode = ctx.settings.permissionMode ?? "manual";
  const profile = ctx.command ? resolveCommandProfile(ctx.command) : undefined;
  const profileId = profile?.id;
  const risk: RiskLevel = profile?.risk ?? "medium";

  // Secret path hard deny for file reads/writes
  if (
    (ctx.action === "read-file" || ctx.action === "write-file") &&
    ctx.path &&
    isDeniedSecretPath(ctx.path)
  ) {
    return {
      decision: "deny",
      reason: `Path is blocked by secret deny list: ${ctx.path}`,
      policy: "secret_path_deny",
      risk: "critical",
      requiresApproval: false,
    };
  }

  // Workspace trust for spawn/git when cwd provided
  if (
    (ctx.action === "spawn" || ctx.action === "git") &&
    ctx.cwd &&
    !isTrustedWorkspacePath(ctx.cwd)
  ) {
    return {
      decision: "deny",
      reason:
        "Working directory is outside trusted workspace roots. Open the repo in Spok to trust it first.",
      policy: "workspace_trust",
      risk: "high",
      profile: profileId,
      requiresApproval: false,
    };
  }

  // Rule evaluation: first matching deny → deny; collect allows/asks
  let matchedAllow: PermissionRule | undefined;
  let matchedAsk: PermissionRule | undefined;

  for (const rule of enabledRules(ctx.settings)) {
    if (!ruleMatches(rule, ctx, profileId)) continue;
    if (rule.effect === "deny") {
      return {
        decision: "deny",
        reason: rule.reason || rule.label || `Denied by rule ${rule.id}`,
        policy: `rule:${rule.id}`,
        risk,
        profile: profileId,
        matchedRuleId: rule.id,
        requiresApproval: false,
      };
    }
    if (rule.effect === "allow" && !matchedAllow) matchedAllow = rule;
    if (rule.effect === "ask" && !matchedAsk) matchedAsk = rule;
  }

  // Prior approval grant (never overrides deny)
  const grant = findGrant(ctx.grants, ctx);
  if (grant) {
    return {
      decision: "allow",
      reason: `Approved (${grant.decision.replace("_", " ")})`,
      policy: `grant:${grant.id}`,
      risk,
      profile: profileId,
      requiresApproval: false,
    };
  }

  // One-shot approval token for this exact request
  if (ctx.approvedFingerprint) {
    const exact = actionFingerprint(ctx, { includeArgs: true });
    const loose = actionFingerprint(ctx, { includeArgs: false });
    if (
      ctx.approvedFingerprint === exact ||
      ctx.approvedFingerprint === loose
    ) {
      return {
        decision: "allow",
        reason: "Approved for this request",
        policy: "approval_token",
        risk,
        profile: profileId,
        requiresApproval: false,
      };
    }
  }

  // Mode-specific gates
  if (mode === "plan") {
    if (ctx.action === "git" || ctx.action === "browse" || ctx.action === "export") {
      return {
        decision: "allow",
        reason: "Plan / read-only mode allows inspection",
        policy: "mode:plan",
        risk: "low",
        profile: profileId,
        requiresApproval: false,
      };
    }
    if (ctx.action === "spawn") {
      if (!profile?.allowedInPlan) {
        return {
          decision: "deny",
          reason: "Plan / read-only mode blocks process spawn",
          policy: "mode:plan",
          risk,
          profile: profileId,
          requiresApproval: false,
        };
      }
    }
    if (ctx.action === "write-file") {
      return {
        decision: "deny",
        reason: "Plan / read-only mode blocks writes",
        policy: "mode:plan",
        risk: "high",
        requiresApproval: false,
      };
    }
  }

  if (mode === "bypass") {
    return {
      decision: "allow",
      reason: "Bypass mode (explicit deny rules still apply)",
      policy: "mode:bypass",
      risk,
      profile: profileId,
      requiresApproval: false,
    };
  }

  // Explicit allow rule wins (user/project policy said allow)
  if (matchedAllow) {
    return {
      decision: "allow",
      reason: matchedAllow.reason || matchedAllow.label || "Allowed by rule",
      policy: `rule:${matchedAllow.id}`,
      risk,
      profile: profileId,
      matchedRuleId: matchedAllow.id,
      requiresApproval: false,
    };
  }

  if (matchedAsk) {
    return {
      decision: "ask",
      reason:
        matchedAsk.reason || matchedAsk.label || "Approval required by rule",
      policy: `rule:${matchedAsk.id}`,
      risk,
      profile: profileId,
      matchedRuleId: matchedAsk.id,
      requiresApproval: true,
    };
  }

  // Custom commands hard gate (no allow rule matched)
  if (
    ctx.action === "spawn" &&
    profileId === "custom" &&
    !ctx.settings.allowCustomCommands
  ) {
    return {
      decision: "ask",
      reason:
        "Custom command is not allowlisted. Approve once/always or enable custom commands in Settings.",
      policy: "custom_command_gate",
      risk: "critical",
      profile: profileId,
      requiresApproval: true,
    };
  }

  // Mode defaults without explicit rule
  if (ctx.action === "spawn" || ctx.action === "git") {
    if (mode === "auto") {
      if (profileId && ctx.settings.autoProfiles.includes(profileId)) {
        return {
          decision: "allow",
          reason: `Auto mode allowlist profile: ${profileId}`,
          policy: "mode:auto",
          risk,
          profile: profileId,
          requiresApproval: false,
        };
      }
      return {
        decision: "ask",
        reason: `Profile "${profileId ?? "unknown"}" is not in auto allowlist`,
        policy: "mode:auto",
        risk,
        profile: profileId,
        requiresApproval: true,
      };
    }

    if (mode === "manual" || mode === "acceptEdits") {
      if (profile && !profile.requiresApprovalInManual) {
        return {
          decision: "allow",
          reason: `${profile.name} is permitted in ${mode} mode`,
          policy: `mode:${mode}`,
          risk,
          profile: profileId,
          requiresApproval: false,
        };
      }
      return {
        decision: "ask",
        reason: profile
          ? `${profile.name} requires approval in ${mode} mode`
          : "Approval required",
        policy: `mode:${mode}`,
        risk,
        profile: profileId,
        requiresApproval: true,
      };
    }
  }

  if (ctx.action === "browse") {
    return {
      decision: "allow",
      reason: "Filesystem browse allowed for local app",
      policy: "default:browse",
      risk: "medium",
      requiresApproval: false,
    };
  }

  if (ctx.action === "export") {
    return {
      decision: "allow",
      reason: "Export allowed (secrets redacted)",
      policy: "default:export",
      risk: "low",
      requiresApproval: false,
    };
  }

  return {
    decision: "ask",
    reason: "No matching allow rule — approval required",
    policy: "default:ask",
    risk,
    profile: profileId,
    requiresApproval: true,
  };
}

export function buildSpawnPreview(
  command: string,
  args: string[],
  cwd: string
): string {
  return `$ ${formatCommandPreview(command, args)}\ncwd: ${cwd}`;
}
