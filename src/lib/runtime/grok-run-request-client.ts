/** Browser-safe builders that move prompt text out of legacy process argv. */

import type { GrokRunFlags } from "@/lib/grok-commands";
import type { GrokRunRequest } from "./grok-run-request";

export function buildInteractiveGrokRunRequest(input: {
  id: string;
  cwd: string;
  command?: string;
  prompt: string;
  attachmentIds?: string[];
  flags: GrokRunFlags;
  resolvedArgs?: string[];
}): GrokRunRequest {
  const nativeWorktree = flagValue(input.resolvedArgs ?? [], ["--worktree", "-w"]);
  return {
    version: 1,
    id: safeRunId(input.id),
    cwd: input.cwd,
    command: input.command || "grok",
    role: "interactive",
    unattended: false,
    workspace: nativeWorktree
      ? { kind: "native_create", sourcePath: input.cwd, name: safeRunId(nativeWorktree) }
      : { kind: "existing", path: input.cwd, isolation: "not_required" },
    prompt: {
      text: input.prompt,
      attachmentIds: input.attachmentIds ?? [],
    },
    session: sessionIntent(input.resolvedArgs ?? []),
    execution: {
      model: input.flags.model,
      agent: input.flags.agent,
      reasoningEffort: input.flags.effort || "medium",
      maxTurns: Math.max(1, Math.min(100, input.flags.maxTurns ?? 20)),
      tools: { allow: [], deny: [] },
      webSearch: "enabled",
      alwaysApprove: input.flags.alwaysApprove,
      permissionMode: input.flags.alwaysApprove ? undefined : input.flags.permissionMode,
      noMemory: input.flags.noMemory,
      noPlan: input.flags.noPlan,
      check: input.flags.check,
      delegation: input.flags.noSubagents
        ? { mode: "deny" }
        : { mode: "allow", budgetRef: "interactive" },
    },
    output: { mode: "stream" },
    debug: { retention: input.flags.debug ? "failure" : "none" },
  };
}

export function buildLeafGrokRunRequest(input: {
  id: string;
  cwd: string;
  branch?: string;
  baseRevision?: string;
  prompt: string;
  maxTurns?: number;
  reasoningEffort?: string;
  permissionMode?: string;
  sandbox?: string;
  output?: "stream" | "report";
}): GrokRunRequest {
  return {
    version: 1,
    id: safeRunId(input.id),
    cwd: input.cwd,
    command: "grok",
    role: "leaf",
    unattended: true,
    workspace: {
      kind: "existing",
      path: input.cwd,
      isolation: "verified",
      branch: input.branch,
      baseRevision: input.baseRevision,
    },
    prompt: { text: input.prompt, attachmentIds: [] },
    session: { intent: "new", sessionId: crypto.randomUUID() },
    execution: {
      reasoningEffort: input.reasoningEffort || "medium",
      maxTurns: Math.max(1, Math.min(100, input.maxTurns ?? 8)),
      tools: { allow: [], deny: [] },
      webSearch: "disabled",
      alwaysApprove: false,
      permissionMode: input.permissionMode || "default",
      sandbox: input.sandbox || "workspace-write",
      noMemory: true,
      noPlan: true,
      check: false,
      delegation: { mode: "deny" },
    },
    output:
      input.output === "report"
        ? { mode: "report", schema: "specialist" }
        : { mode: "stream" },
    debug: { retention: "failure" },
  };
}

function sessionIntent(args: string[]): GrokRunRequest["session"] {
  if (args.includes("--continue") || args.includes("-c")) {
    return { intent: "continue_latest" };
  }
  const resumeIndex = args.findIndex((value) => value === "--resume" || value === "-r");
  if (resumeIndex >= 0) {
    const candidate = args[resumeIndex + 1];
    if (!candidate || candidate.startsWith("-")) return { intent: "continue_latest" };
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidate)) {
      return { intent: "resume", sessionId: candidate };
    }
    throw new Error("Resume requires an exact UUID session id or no id for interactive latest-session continuation");
  }
  return { intent: "new" };
}

function flagValue(args: string[], flags: string[]): string | undefined {
  const index = args.findIndex((value) => flags.includes(value));
  return index >= 0 ? args[index + 1] : undefined;
}

function safeRunId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `run-${cleaned || "prompt"}`;
}
