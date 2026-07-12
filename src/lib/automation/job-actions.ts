import type { AutomationJob, JobKind, QueueItemStatus } from "./types";

export type InboxJobAction =
  | "cancel"
  | "retry"
  | "duplicate"
  | "priority_up"
  | "priority_down";

export type JobActionAvailability = Record<InboxJobAction, boolean>;

const ACTIVE_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  "queued",
  "starting",
  "running",
  "waiting_approval",
]);

const RETRYABLE_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  "failed",
  "cancelled",
  "skipped",
]);

const TERMINAL_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

export function getJobActionAvailability(
  status: QueueItemStatus
): JobActionAvailability {
  const queued = status === "queued";
  return {
    cancel: ACTIVE_STATUSES.has(status),
    retry: RETRYABLE_STATUSES.has(status),
    duplicate: TERMINAL_STATUSES.has(status),
    priority_up: queued,
    priority_down: queued,
  };
}

/** Fields accepted by enqueueBackgroundJob, kept independent from client code. */
export type BackgroundJobBlueprint = {
  title: string;
  prompt: string;
  cwd: string;
  isolate: boolean;
  kind: JobKind;
  priority: number;
  parentSessionId?: string;
  agentId?: string;
  enterprise?: AutomationJob["enterprise"];
};

export type CloneJobIntent = "retry" | "duplicate";

export type CloneJobResult =
  | { ok: true; blueprint: BackgroundJobBlueprint }
  | { ok: false; reason: string };

function comparablePath(path: string | undefined): string {
  return (path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Build a fresh job input without carrying execution identity or live isolation
 * links. Trigger ownership (schedule/channel), session ids, branch, worktree,
 * timestamps, outcome, and errors intentionally do not cross the clone boundary.
 */
export function cloneJobBlueprint(
  job: AutomationJob,
  intent: CloneJobIntent
): CloneJobResult {
  const oldWorktree = comparablePath(job.worktreePath);
  const mainCheckout = job.mainCheckout?.trim();
  const cwd = (mainCheckout || job.cwd).trim();

  if (!cwd) {
    return { ok: false, reason: "The original workspace is unavailable." };
  }
  if (oldWorktree && comparablePath(cwd) === oldWorktree) {
    return {
      ok: false,
      reason:
        "The original checkout is unavailable; the linked worktree cannot be reused.",
    };
  }

  const prefix = intent === "retry" ? "Retry" : "Copy";
  return {
    ok: true,
    blueprint: {
      title: `${prefix} · ${job.title}`.slice(0, 96),
      prompt: job.prompt,
      cwd,
      isolate: job.isolate,
      kind: job.kind,
      priority: job.priority,
      parentSessionId: job.parentSessionId,
      agentId: job.agentId,
      ...(intent === "retry" && job.enterprise
        ? { enterprise: job.enterprise }
        : {}),
    },
  };
}
