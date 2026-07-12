import { nanoid } from "nanoid";
import type { AutomationJob, JobKind, QueueItemStatus } from "./types";
import {
  AUTOMATION_DEFAULTS,
  clampAutomationConcurrency,
} from "./types";

/** Pure queue helpers (client-side orchestration). */

export function createJob(partial: {
  kind: JobKind;
  title: string;
  prompt: string;
  cwd: string;
  isolate?: boolean;
  priority?: number;
  parentSessionId?: string;
  scheduleId?: string;
  channelId?: string;
  agentId?: string;
  enterprise?: AutomationJob["enterprise"];
  worktreePath?: string;
  branch?: string;
  mainCheckout?: string;
}): AutomationJob {
  const now = Date.now();
  return {
    id: `job-${nanoid(10)}`,
    kind: partial.kind,
    title: partial.title.trim() || "Background job",
    prompt: partial.prompt.trim(),
    cwd: partial.cwd.trim(),
    isolate: partial.isolate !== false,
    worktreePath: partial.worktreePath,
    branch: partial.branch,
    mainCheckout: partial.mainCheckout,
    status: "queued",
    priority: partial.priority ?? 0,
    createdAt: now,
    updatedAt: now,
    parentSessionId: partial.parentSessionId,
    scheduleId: partial.scheduleId,
    channelId: partial.channelId,
    agentId: partial.agentId,
    enterprise: partial.enterprise,
    policy: {
      requireTrusted: true,
      isolate: partial.isolate !== false,
      profile: partial.agentId,
    },
  };
}

export function sortQueue(jobs: AutomationJob[]): AutomationJob[] {
  return [...jobs].sort((a, b) => {
    // Higher priority first, then FIFO
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.createdAt - b.createdAt;
  });
}

export function countRunning(jobs: AutomationJob[]): number {
  return jobs.filter(
    (j) =>
      j.status === "starting" ||
      j.status === "running" ||
      j.status === "waiting_approval"
  ).length;
}

/** Pick next queued jobs up to concurrency limit. */
export function pickNextJobs(
  jobs: AutomationJob[],
  maxConcurrent: number = AUTOMATION_DEFAULTS.maxConcurrentBackground
): AutomationJob[] {
  const running = countRunning(jobs);
  const slots = Math.max(0, clampAutomationConcurrency(maxConcurrent) - running);
  if (slots === 0) return [];
  return sortQueue(jobs)
    .filter((j) => j.status === "queued")
    .slice(0, slots);
}

export type JobQueueStatus = {
  position: number;
  totalQueued: number;
  running: number;
  limit: number;
  reason: string;
};

/** Explain a queued job using the same priority/FIFO order as the runner. */
export function describeJobQueueStatus(
  jobs: AutomationJob[],
  jobId: string,
  maxConcurrent: number = AUTOMATION_DEFAULTS.maxConcurrentBackground
): JobQueueStatus | null {
  const queued = sortQueue(jobs).filter((job) => job.status === "queued");
  const index = queued.findIndex((job) => job.id === jobId);
  if (index < 0) return null;

  const running = countRunning(jobs);
  const limit = clampAutomationConcurrency(maxConcurrent);
  const position = index + 1;
  const queuePosition = `#${position} of ${queued.length}`;
  const reason =
    running >= limit
      ? `Waiting for capacity · ${running}/${limit} slots in use · ${queuePosition}`
      : position === 1
        ? "Next to start · preparing a safe launch"
        : `Queued behind ${position - 1} higher-priority ${position === 2 ? "job" : "jobs"} · ${queuePosition}`;

  return {
    position,
    totalQueued: queued.length,
    running,
    limit,
    reason,
  };
}

export function patchJob(
  jobs: AutomationJob[],
  id: string,
  patch: Partial<AutomationJob>
): AutomationJob[] {
  return jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
}

export function trimJobHistory(
  jobs: AutomationJob[],
  max: number = AUTOMATION_DEFAULTS.maxQueueHistory
): AutomationJob[] {
  if (jobs.length <= max) return jobs;
  // Keep all active + newest finished
  const active = jobs.filter((j) =>
    ["queued", "starting", "running", "waiting_approval"].includes(j.status)
  );
  const done = jobs
    .filter((j) => !active.includes(j))
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt));
  return [...active, ...done].slice(0, max);
}

/** Merge a boot ledger without overwriting jobs created while GET was in flight. */
export function mergeRecoveredJobs(
  current: AutomationJob[],
  recovered: AutomationJob[]
): AutomationJob[] {
  const currentIds = new Set(current.map((job) => job.id));
  return trimJobHistory([
    ...current,
    ...recovered.filter((job) => !currentIds.has(job.id)),
  ]);
}

export function jobStatusLabel(status: QueueItemStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "starting":
      return "Preparing";
    case "running":
      return "Running";
    case "waiting_approval":
      return "Needs approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    default:
      return status;
  }
}

/** Build a short summary from session metrics after a run. */
export function summarizeJobResult(opts: {
  status: QueueItemStatus;
  exitCode?: number | null;
  error?: string;
  filesChanged?: number;
  toolCalls?: number;
}): string {
  if (opts.status === "cancelled") return "Cancelled by user";
  if (opts.status === "skipped") return opts.error || "Skipped by policy";
  if (opts.status === "failed") {
    return opts.error || `Failed (exit ${opts.exitCode ?? "?"})`;
  }
  if (opts.status === "completed") {
    const bits = ["Completed"];
    if (opts.filesChanged != null) bits.push(`${opts.filesChanged} files`);
    if (opts.toolCalls != null) bits.push(`${opts.toolCalls} tools`);
    return bits.join(" · ");
  }
  return jobStatusLabel(opts.status);
}
