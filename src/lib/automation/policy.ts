import { isTrustedWorkspacePath } from "@/lib/security/workspace-trust";
import type { ScheduleDefinition, ChannelDefinition } from "./types";

export type AutomationPolicyDecision =
  | { ok: true; reason: string }
  | { ok: false; reason: string; code: string };

/**
 * Scheduled / background / channel jobs may only run inside trusted workspaces
 * when requireTrusted is set (default true).
 */
export function evaluateAutomationCwdPolicy(opts: {
  cwd: string;
  requireTrusted?: boolean;
  isolate?: boolean;
  mainCheckout?: string;
}): AutomationPolicyDecision {
  const cwd = opts.cwd?.trim();
  if (!cwd) {
    return { ok: false, reason: "Working directory is required", code: "missing_cwd" };
  }

  const requireTrusted = opts.requireTrusted !== false;
  if (requireTrusted && !isTrustedWorkspacePath(cwd)) {
    return {
      ok: false,
      reason:
        "Workspace is not trusted. Open the repo in Spok before running automated jobs.",
      code: "untrusted_cwd",
    };
  }

  // Isolation guard: if isolate is requested and we have a main checkout path,
  // refuse to run when cwd equals main checkout (job should use worktree).
  // The runner must establish the linked worktree before requesting this gate.
  if (
    opts.isolate &&
    opts.mainCheckout &&
    normalize(opts.cwd) === normalize(opts.mainCheckout)
  ) {
    return {
      ok: false,
      reason:
        "Isolated job refused to run on main checkout. Use a worktree path.",
      code: "isolation_guard",
    };
  }

  return {
    ok: true,
    reason: requireTrusted ? "Trusted workspace" : "Trust check skipped",
  };
}

export function evaluateSchedulePolicy(
  schedule: ScheduleDefinition
): AutomationPolicyDecision {
  if (!schedule.enabled) {
    return { ok: false, reason: "Schedule is disabled", code: "disabled" };
  }
  if (!schedule.prompt.trim()) {
    return { ok: false, reason: "Schedule prompt is empty", code: "empty_prompt" };
  }
  return evaluateAutomationCwdPolicy({
    cwd: schedule.cwd,
    requireTrusted: schedule.requireTrusted,
    isolate: schedule.isolate,
  });
}

export function evaluateChannelPolicy(
  channel: ChannelDefinition
): AutomationPolicyDecision {
  if (!channel.enabled) {
    return { ok: false, reason: "Channel is disabled", code: "disabled" };
  }
  return evaluateAutomationCwdPolicy({
    cwd: channel.cwd,
    requireTrusted: channel.requireTrusted,
    isolate: channel.isolate,
  });
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
