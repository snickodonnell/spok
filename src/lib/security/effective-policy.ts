/**
 * Presentation helpers for effective permission policy and
 * confirm-before-escalation (UX-009 / spok-secure-runtime).
 *
 * Does NOT rewrite the server policy engine — only ranks risk, builds a
 * human-readable effective summary, and gates high-risk provider flags.
 */

import type { AppPermissionMode } from "@/lib/settings/types";
import type { GrokRunFlags } from "@/lib/grok-commands";

/** Session Grok CLI permission selector values (composer + sticky flags). */
export type ProviderPermissionSelection =
  | "manual"
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions"
  | "always-approve";

export type PolicyRiskTier = "low" | "medium" | "high" | "critical";

/** Higher number = more dangerous. */
const PROVIDER_RISK_RANK: Record<ProviderPermissionSelection, number> = {
  plan: 0,
  manual: 1,
  default: 2,
  acceptEdits: 3,
  auto: 4,
  dontAsk: 6,
  bypassPermissions: 7,
  "always-approve": 7,
};

const PROVIDER_RISK_TIER: Record<ProviderPermissionSelection, PolicyRiskTier> = {
  plan: "low",
  manual: "low",
  default: "low",
  acceptEdits: "medium",
  auto: "medium",
  dontAsk: "high",
  bypassPermissions: "critical",
  "always-approve": "critical",
};

const PROVIDER_LABELS: Record<ProviderPermissionSelection, string> = {
  plan: "Plan",
  manual: "Manual (safe)",
  default: "Default",
  acceptEdits: "Accept edits",
  auto: "Auto",
  dontAsk: "Don't ask",
  bypassPermissions: "Bypass permissions",
  "always-approve": "Always approve",
};

/** Modes that require visible scope/duration confirmation before state mutates. */
export const HIGH_RISK_PROVIDER_MODES: ReadonlySet<ProviderPermissionSelection> =
  new Set(["dontAsk", "bypassPermissions", "always-approve"]);

const APP_MODE_LABELS: Record<AppPermissionMode, string> = {
  manual: "Manual",
  plan: "Plan / read-only",
  acceptEdits: "Accept edits",
  auto: "Auto (allowlisted)",
  bypass: "Bypass (dangerous)",
};

export const POLICY_PRECEDENCE_LINES = [
  "App policy sets the Spok gate for privileged actions (spawn, git, file, export).",
  "Provider/session flags (Grok CLI --permission-mode / --always-approve) apply to the agent run.",
  "Explicit allow rules and approval grants can satisfy ask decisions within policy.",
  "Deny rules always win — no mode or flag can override an enabled deny rule.",
] as const;

export function isProviderPermissionSelection(
  value: string
): value is ProviderPermissionSelection {
  return Object.prototype.hasOwnProperty.call(PROVIDER_RISK_RANK, value);
}

/** Resolve the current composer selection from sticky Grok flags. */
export function currentProviderSelection(flags: {
  alwaysApprove?: boolean;
  permissionMode?: string;
}): ProviderPermissionSelection {
  if (flags.alwaysApprove) return "always-approve";
  const mode = flags.permissionMode;
  if (mode && isProviderPermissionSelection(mode)) return mode;
  if (mode) {
    // Unknown sticky value — treat as default CLI mode, not silent bypass.
    return "default";
  }
  return "manual";
}

export function providerSelectionLabel(
  selection: ProviderPermissionSelection
): string {
  return PROVIDER_LABELS[selection];
}

export function providerRiskTier(
  selection: ProviderPermissionSelection
): PolicyRiskTier {
  return PROVIDER_RISK_TIER[selection];
}

export function providerRiskRank(
  selection: ProviderPermissionSelection
): number {
  return PROVIDER_RISK_RANK[selection];
}

export function isHighRiskProviderMode(
  selection: ProviderPermissionSelection | string
): boolean {
  return HIGH_RISK_PROVIDER_MODES.has(
    selection as ProviderPermissionSelection
  );
}

/**
 * True when moving to a high-risk provider mode that is not already active.
 * Safer / equal modes never require confirmation (de-escalation is immediate).
 */
export function requiresEscalationConfirmation(
  from: ProviderPermissionSelection,
  to: ProviderPermissionSelection
): boolean {
  if (from === to) return false;
  if (!isHighRiskProviderMode(to)) return false;
  // Already on this elevated mode — no re-confirm. Cross-elevated switches do.
  return true;
}

/** De-escalation or lateral move to a non-high-risk mode. */
export function isDeescalationOrSafeChange(
  from: ProviderPermissionSelection,
  to: ProviderPermissionSelection
): boolean {
  if (from === to) return false;
  return !requiresEscalationConfirmation(from, to);
}

/** Sticky flag patch for a provider selection (does not touch other flags). */
export function flagsForProviderSelection(
  selection: ProviderPermissionSelection
): Pick<GrokRunFlags, "alwaysApprove" | "permissionMode"> {
  if (selection === "always-approve") {
    return { alwaysApprove: true, permissionMode: undefined };
  }
  if (selection === "manual") {
    return { alwaysApprove: false, permissionMode: undefined };
  }
  return { alwaysApprove: false, permissionMode: selection };
}

export type EffectivePolicySummary = {
  appMode: AppPermissionMode;
  appLabel: string;
  providerSelection: ProviderPermissionSelection;
  providerLabel: string;
  elevated: boolean;
  riskTier: PolicyRiskTier;
  riskLabel: string;
  headline: string;
  /** Where the elevated provider flags apply. */
  scope: string;
  /** How long elevated flags remain in effect. */
  duration: string;
  riskExplanation: string;
  precedence: readonly string[];
  providerDetail: { key: string; value: string }[];
  alwaysApprove: boolean;
  permissionMode?: string;
};

export type BuildEffectivePolicyInput = {
  appPermissionMode: AppPermissionMode;
  flags: {
    alwaysApprove?: boolean;
    permissionMode?: string;
    model?: string;
    check?: boolean;
  };
  cwd?: string;
};

function riskLabelFor(tier: PolicyRiskTier): string {
  switch (tier) {
    case "low":
      return "Low risk";
    case "medium":
      return "Elevated caution";
    case "high":
      return "High risk";
    case "critical":
      return "Critical risk";
  }
}

function riskExplanationFor(
  selection: ProviderPermissionSelection
): string {
  switch (selection) {
    case "dontAsk":
      return "Don't ask suppresses interactive permission prompts for this session's Grok runs. Tools may execute without per-action confirmation.";
    case "bypassPermissions":
      return "Bypass permissions disables Grok CLI permission checks for this session. Only use in trusted, disposable workspaces.";
    case "always-approve":
      return "Always approve auto-approves tool use for this session (Grok --always-approve). Tools run without prompts.";
    case "auto":
      return "Auto mode reduces prompts for allowlisted profiles; deny rules still apply at the Spok gate.";
    case "acceptEdits":
      return "Accept edits allows workspace edits with fewer prompts; custom binaries remain gated by app policy.";
    case "plan":
      return "Plan mode is read-oriented for the provider run.";
    case "default":
      return "Default uses Grok CLI's built-in permission mode for this session.";
    case "manual":
    default:
      return "Manual keeps provider auto-approve off; Spok app policy still gates privileged actions.";
  }
}

/**
 * One effective policy summary for the session: app mode + provider flags + risk.
 */
export function buildEffectivePolicySummary(
  input: BuildEffectivePolicyInput
): EffectivePolicySummary {
  const providerSelection = currentProviderSelection(input.flags);
  const riskTier = providerRiskTier(providerSelection);
  // App bypass is also elevated even if provider is manual.
  const appElevated = input.appPermissionMode === "bypass";
  const elevated =
    isHighRiskProviderMode(providerSelection) || appElevated;
  const effectiveTier: PolicyRiskTier = appElevated
    ? "critical"
    : riskTier;
  const providerLabel = providerSelectionLabel(providerSelection);
  const appLabel = APP_MODE_LABELS[input.appPermissionMode];
  const cwd = input.cwd?.trim() || "(no workspace cwd)";

  const scope = `This session only — sticky Grok flags on the active task (${cwd}). App policy is global until changed in Settings.`;
  const duration = elevated
    ? "Until you change the provider mode or end this session (sticky for subsequent prompts in this session)."
    : "Standard session lifetime; no elevated provider flags active.";

  const providerDetail: { key: string; value: string }[] = [
    { key: "App permission mode", value: `${appLabel} (${input.appPermissionMode})` },
    { key: "Provider selection", value: providerLabel },
    {
      key: "alwaysApprove",
      value: input.flags.alwaysApprove === true ? "true" : "false",
    },
    {
      key: "permissionMode flag",
      value: input.flags.permissionMode ?? "(unset — manual)",
    },
    { key: "Scope", value: "Session sticky flags" },
    { key: "Duration", value: elevated ? "Until changed / session end" : "N/A" },
    {
      key: "Run mode",
      value: input.flags.check ? "check only" : "agent",
    },
  ];
  if (input.flags.model) {
    providerDetail.push({ key: "Model", value: input.flags.model });
  }

  const headline = elevated
    ? `Elevated: ${providerLabel} · app ${appLabel}`
    : `Effective: app ${appLabel} · provider ${providerLabel}`;

  return {
    appMode: input.appPermissionMode,
    appLabel,
    providerSelection,
    providerLabel,
    elevated,
    riskTier: effectiveTier,
    riskLabel: riskLabelFor(effectiveTier),
    headline,
    scope,
    duration,
    riskExplanation: riskExplanationFor(providerSelection),
    precedence: POLICY_PRECEDENCE_LINES,
    providerDetail,
    alwaysApprove: input.flags.alwaysApprove === true,
    permissionMode: input.flags.permissionMode,
  };
}

export type EscalationConfirmationCopy = {
  title: string;
  description: string;
  detail: string;
  scope: string;
  duration: string;
  riskExplanation: string;
  confirmLabel: string;
  tone: "danger" | "amber";
  selection: ProviderPermissionSelection;
};

/** Copy for the confirm-before-escalation dialog. */
export function buildEscalationConfirmation(
  target: ProviderPermissionSelection,
  opts?: { cwd?: string }
): EscalationConfirmationCopy {
  const label = providerSelectionLabel(target);
  const tier = providerRiskTier(target);
  const tone = tier === "critical" ? "danger" : "amber";
  const cwd = opts?.cwd?.trim() || "this session workspace";
  const scope = `This session only (sticky Grok flags). Does not change global app policy in Settings. Workspace: ${cwd}`;
  const duration =
    "Until you switch to a safer mode or the session ends. Applies to subsequent prompts in this session.";
  const riskExplanation = riskExplanationFor(target);

  const detail = [
    `Target mode: ${label}`,
    `Risk: ${riskLabelFor(tier)}`,
    `Scope: ${scope}`,
    `Duration: ${duration}`,
    "",
    riskExplanation,
    "",
    "Deny rules still win at the Spok gate. Prefer trusted, disposable workspaces only.",
  ].join("\n");

  return {
    title: `Confirm elevated permissions: ${label}`,
    description:
      "This increases permission risk. Review scope and duration before confirming. State will not change until you confirm.",
    detail,
    scope,
    duration,
    riskExplanation,
    confirmLabel: `Enable ${label}`,
    tone,
    selection: target,
  };
}
