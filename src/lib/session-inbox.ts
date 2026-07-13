/**
 * Session inbox — operational lanes for multi-session mission control.
 *
 * Derives queued / running / waiting / failed / ready-for-review / idle from
 * existing session + automation job state. Pure and cheap enough for sidebar
 * re-renders (no full validation-lane walk unless files are already loaded).
 *
 * Horizon 3: Agent Mission Control
 */

import type { AutomationJob } from "./automation/types";
import {
  getJobActionAvailability,
  type JobActionAvailability,
} from "./automation/job-actions";
import { describeJobQueueStatus } from "./automation/queue";
import type { Session, SessionStatus } from "./types";

/** Operational inbox lane (UI-derived; not a durable SessionStatus). */
export type InboxLane =
  | "waiting"
  | "running"
  | "queued"
  | "failed"
  | "ready_review"
  | "idle";

export type InboxLaneMeta = {
  id: InboxLane;
  label: string;
  short: string;
  /** Higher = more urgent; sort groups top-down. */
  rank: number;
  description: string;
};

export const INBOX_LANE_META: Record<InboxLane, InboxLaneMeta> = {
  waiting: {
    id: "waiting",
    label: "Needs attention",
    short: "Wait",
    rank: 0,
    description: "Blocked on approval, conflicts, or pause",
  },
  running: {
    id: "running",
    label: "Running",
    short: "Run",
    rank: 1,
    description: "Agent is starting or actively working",
  },
  queued: {
    id: "queued",
    label: "Queued",
    short: "Queue",
    rank: 2,
    description: "Background job waiting to start",
  },
  failed: {
    id: "failed",
    label: "Failed",
    short: "Fail",
    rank: 3,
    description: "Last run ended in error",
  },
  ready_review: {
    id: "ready_review",
    label: "Ready for review",
    short: "Review",
    rank: 4,
    description: "Changes or dirty tree waiting for review",
  },
  idle: {
    id: "idle",
    label: "Idle",
    short: "Idle",
    rank: 5,
    description: "No active work or pending review",
  },
};

/** Stable display order for lane groups (empty lanes omitted in UI). */
export const INBOX_LANE_ORDER: InboxLane[] = [
  "waiting",
  "running",
  "queued",
  "failed",
  "ready_review",
  "idle",
];

export type InboxEntry = {
  /** Stable row identity for session-backed and pre-session job rows. */
  entryId: string;
  /** Empty until a queued background job creates its session. */
  sessionId: string;
  name: string;
  lane: InboxLane;
  /** One-line operational reason for the lane. */
  reason: string;
  status: SessionStatus;
  cwd: string;
  source: Session["source"] | "job";
  updatedAt: number;
  durable: boolean;
  eventCount: number;
  filesChanged: number;
  errorCount: number;
  conflictCount: number;
  branch: string | null;
  isWorktree: boolean;
  backgroundJob: boolean;
  hydratePartial: boolean;
  /** Linked automation job status when present. */
  jobStatus?: AutomationJob["status"];
  jobId?: string;
  jobPriority?: number;
  jobActions?: JobActionAvailability;
  /** Sort within lane: lower first (more urgent / newer). */
  sortKey: number;
};

export type InboxSummary = {
  total: number;
  byLane: Record<InboxLane, number>;
  /** waiting + failed — badge chrome. */
  attentionCount: number;
  /** running + queued + waiting. */
  activeCount: number;
  readyReviewCount: number;
  headline: string;
};

export type SessionInbox = {
  entries: InboxEntry[];
  groups: { lane: InboxLane; entries: InboxEntry[] }[];
  summary: InboxSummary;
};

export type ClassifyInboxOptions = {
  /** Automation jobs that may link to sessions via sessionId. */
  jobs?: AutomationJob[];
  /** Global runner slots used to explain queue position and capacity waits. */
  maxConcurrentBackground?: number;
};

function jobBySessionId(
  jobs: AutomationJob[] | undefined
): Map<string, AutomationJob> {
  const map = new Map<string, AutomationJob>();
  if (!jobs?.length) return map;
  // Prefer active jobs over finished when multiple share a session.
  const rank = (s: AutomationJob["status"]) => {
    switch (s) {
      case "waiting_approval":
        return 0;
      case "running":
        return 1;
      case "starting":
        return 1;
      case "queued":
        return 2;
      case "failed":
        return 3;
      default:
        return 9;
    }
  };
  for (const j of jobs) {
    if (!j.sessionId) continue;
    const prev = map.get(j.sessionId);
    if (!prev || rank(j.status) < rank(prev.status)) {
      map.set(j.sessionId, j);
    }
  }
  return map;
}

function countFilesChanged(session: Session): number {
  const fromMetrics = session.metrics?.filesChanged ?? 0;
  if (fromMetrics > 0) return fromMetrics;
  if (session.hydratePartial) return 0;
  return Object.keys(session.files ?? {}).length;
}

function conflictCount(session: Session): number {
  if (session.gitSummary?.conflictCount != null) {
    return session.gitSummary.conflictCount;
  }
  if (session.hydratePartial) return 0;
  return Object.values(session.files ?? {}).filter((f) => f.conflict).length;
}

function dirtyCount(session: Session): number {
  const g = session.gitSummary;
  if (g) {
    return (g.stagedCount ?? 0) + (g.unstagedCount ?? 0) + (g.untrackedCount ?? 0);
  }
  if (session.hydratePartial) return 0;
  return Object.values(session.files ?? {}).filter(
    (f) => f.staged || f.unstaged || f.untracked
  ).length;
}

function hasReviewableWork(session: Session): boolean {
  if (countFilesChanged(session) > 0) return true;
  if (dirtyCount(session) > 0) return true;
  const comments = session.reviewComments ?? [];
  if (comments.some((c) => !c.resolved)) return true;
  return false;
}

/**
 * Classify a single session into an inbox lane.
 * Priority: waiting > running > queued > failed > ready_review > idle
 */
export function classifySessionLane(
  session: Session,
  job?: AutomationJob | null
): { lane: InboxLane; reason: string } {
  const status = session.status;
  const conflicts = conflictCount(session);
  const files = countFilesChanged(session);
  const errors = session.metrics?.errorCount ?? 0;

  if (session.restoreState === "unavailable") {
    return {
      lane: "waiting",
      reason: session.restoreError?.trim().slice(0, 64) || "Saved details unavailable",
    };
  }

  if (session.restoreState === "restoring" || session.hydratePartial) {
    return { lane: "waiting", reason: "Restoring saved details" };
  }

  if (job?.status === "waiting_approval") {
    return { lane: "waiting", reason: "Waiting for approval" };
  }

  if (status === "paused") {
    return { lane: "waiting", reason: "Paused" };
  }

  if (conflicts > 0) {
    return {
      lane: "waiting",
      reason:
        conflicts === 1 ? "1 merge conflict" : `${conflicts} merge conflicts`,
    };
  }

  if (status === "running" || status === "starting") {
    return {
      lane: "running",
      reason: status === "starting" ? "Starting…" : "Agent running",
    };
  }

  if (job?.status === "running") {
    return { lane: "running", reason: "Background job running" };
  }

  if (job?.status === "starting") {
    return { lane: "running", reason: "Preparing isolated workspace" };
  }

  if (job?.status === "queued") {
    return { lane: "queued", reason: "Queued background job" };
  }

  if (status === "error" || job?.status === "failed") {
    const detail =
      session.error?.trim().slice(0, 48) ||
      job?.error?.trim().slice(0, 48) ||
      (errors > 0 ? `${errors} error(s)` : "Run failed");
    return { lane: "failed", reason: detail };
  }

  if (hasReviewableWork(session)) {
    if (files > 0) {
      return {
        lane: "ready_review",
        reason: files === 1 ? "1 file changed" : `${files} files changed`,
      };
    }
    const dirty = dirtyCount(session);
    if (dirty > 0) {
      return {
        lane: "ready_review",
        reason: dirty === 1 ? "1 dirty path" : `${dirty} dirty paths`,
      };
    }
    const openComments = (session.reviewComments ?? []).filter(
      (c) => !c.resolved
    ).length;
    if (openComments > 0) {
      return {
        lane: "ready_review",
        reason:
          openComments === 1
            ? "1 open review comment"
            : `${openComments} open review comments`,
      };
    }
    return { lane: "ready_review", reason: "Ready for review" };
  }

  if (job?.status === "cancelled") {
    return { lane: "idle", reason: "Background job cancelled" };
  }
  if (job?.status === "skipped") {
    return {
      lane: "idle",
      reason: job.error?.trim().slice(0, 48) || "Background job skipped",
    };
  }
  if (job?.status === "completed") {
    return { lane: "idle", reason: "Background job completed" };
  }

  if (status === "completed") {
    return { lane: "idle", reason: "Completed" };
  }
  if (status === "stopped") {
    return { lane: "idle", reason: "Stopped" };
  }
  if (status === "ready") {
    return { lane: "idle", reason: "Ready" };
  }
  return { lane: "idle", reason: "Idle" };
}

export function toInboxEntry(
  session: Session,
  job?: AutomationJob | null
): InboxEntry {
  const { lane, reason } = classifySessionLane(session, job);
  const laneRank = INBOX_LANE_META[lane].rank;
  // Within a lane: newer activity first; waiting/failed slightly prefer more errors.
  const urgencyBoost =
    lane === "waiting" || lane === "failed"
      ? (session.metrics?.errorCount ?? 0) * 1e6
      : 0;

  return {
    entryId: `session:${session.id}`,
    sessionId: session.id,
    name: session.name,
    lane,
    reason,
    status: session.status,
    cwd: session.config?.cwd ?? "",
    source: session.source,
    updatedAt: session.updatedAt,
    durable: session.durable !== false,
    eventCount: session.eventCount ?? 0,
    filesChanged: countFilesChanged(session),
    errorCount: session.metrics?.errorCount ?? 0,
    conflictCount: conflictCount(session),
    branch: session.gitSummary?.branch ?? null,
    isWorktree: !!session.gitSummary?.isWorktree || !!session.config?.worktreePath,
    backgroundJob: !!session.backgroundJob || !!job,
    hydratePartial: !!session.hydratePartial,
    jobStatus: job?.status,
    jobId: job?.id,
    jobPriority: job?.priority,
    jobActions: job ? getJobActionAvailability(job.status) : undefined,
    sortKey: laneRank * 1e15 - urgencyBoost - session.updatedAt,
  };
}

function jobLane(job: AutomationJob): { lane: InboxLane; reason: string } {
  switch (job.status) {
    case "waiting_approval":
      return { lane: "waiting", reason: "Waiting for approval" };
    case "running":
      return { lane: "running", reason: "Background job running" };
    case "starting":
      return { lane: "running", reason: "Preparing isolated workspace" };
    case "queued":
      return {
        lane: "queued",
        reason:
          job.priority === 0
            ? "Queued background job"
            : `Queued · priority ${job.priority}`,
      };
    case "failed":
      return {
        lane: "failed",
        reason: job.error?.trim().slice(0, 48) || "Background job failed",
      };
    case "cancelled":
      return { lane: "idle", reason: "Background job cancelled" };
    case "skipped":
      return {
        lane: "idle",
        reason: job.error?.trim().slice(0, 48) || "Background job skipped",
      };
    default:
      return { lane: "idle", reason: "Background job completed" };
  }
}

/** Queue/history entry used before a background job has created a session. */
export function jobToInboxEntry(job: AutomationJob): InboxEntry {
  const { lane, reason } = jobLane(job);
  const updatedAt = job.finishedAt ?? job.startedAt ?? job.createdAt;
  return {
    entryId: `job:${job.id}`,
    sessionId: "",
    name: job.title,
    lane,
    reason,
    status:
      job.status === "running"
        ? "running"
        : job.status === "starting"
          ? "starting"
        : job.status === "failed"
          ? "error"
          : job.status === "completed"
            ? "completed"
            : job.status === "cancelled"
              ? "stopped"
              : "ready",
    cwd: job.cwd,
    source: "job",
    updatedAt,
    durable: false,
    eventCount: 0,
    filesChanged: 0,
    errorCount: job.status === "failed" ? 1 : 0,
    conflictCount: 0,
    branch: job.branch ?? null,
    isWorktree: !!job.worktreePath,
    backgroundJob: true,
    hydratePartial: false,
    jobStatus: job.status,
    jobId: job.id,
    jobPriority: job.priority,
    jobActions: getJobActionAvailability(job.status),
    sortKey: INBOX_LANE_META[lane].rank * 1e15 - updatedAt,
  };
}

export function buildSessionInbox(
  sessions: Session[] | Record<string, Session>,
  opts: ClassifyInboxOptions = {}
): SessionInbox {
  const list = Array.isArray(sessions) ? sessions : Object.values(sessions);
  const jobs = opts.jobs ?? [];
  const jobMap = jobBySessionId(jobs);
  const sessionIds = new Set(list.map((session) => session.id));

  const entries = [
    ...list.map((s) => toInboxEntry(s, jobMap.get(s.id) ?? null)),
    ...jobs
      .filter((job) => !job.sessionId || !sessionIds.has(job.sessionId))
      .map(jobToInboxEntry),
  ]
    .map((entry) => {
      if (entry.jobStatus !== "queued" || !entry.jobId) return entry;
      const queue = describeJobQueueStatus(
        jobs,
        entry.jobId,
        opts.maxConcurrentBackground
      );
      return queue ? { ...entry, reason: queue.reason } : entry;
    })
    .sort((a, b) => a.sortKey - b.sortKey || b.updatedAt - a.updatedAt);

  const byLane: Record<InboxLane, number> = {
    waiting: 0,
    running: 0,
    queued: 0,
    failed: 0,
    ready_review: 0,
    idle: 0,
  };
  for (const e of entries) byLane[e.lane]++;

  const groups = INBOX_LANE_ORDER.filter((lane) => byLane[lane] > 0).map(
    (lane) => ({
      lane,
      entries: entries.filter((e) => e.lane === lane),
    })
  );

  const attentionCount = byLane.waiting + byLane.failed;
  const activeCount = byLane.running + byLane.queued + byLane.waiting;
  const readyReviewCount = byLane.ready_review;

  let headline: string;
  if (entries.length === 0) {
    headline = "No sessions";
  } else if (byLane.waiting > 0) {
    headline =
      byLane.waiting === 1
        ? "1 session needs attention"
        : `${byLane.waiting} sessions need attention`;
  } else if (byLane.failed > 0) {
    headline =
      byLane.failed === 1
        ? "1 failed session"
        : `${byLane.failed} failed sessions`;
  } else if (byLane.running > 0) {
    headline =
      byLane.running === 1
        ? "1 agent running"
        : `${byLane.running} agents running`;
  } else if (readyReviewCount > 0) {
    headline =
      readyReviewCount === 1
        ? "1 session ready for review"
        : `${readyReviewCount} sessions ready for review`;
  } else if (byLane.queued > 0) {
    headline =
      byLane.queued === 1 ? "1 job queued" : `${byLane.queued} jobs queued`;
  } else {
    headline =
      entries.length === 1
        ? "1 session idle"
        : `${entries.length} sessions idle`;
  }

  return {
    entries,
    groups,
    summary: {
      total: entries.length,
      byLane,
      attentionCount,
      activeCount,
      readyReviewCount,
      headline,
    },
  };
}

/**
 * Compact fingerprint for store selectors.
 * Omits high-churn fields (token streaming) so the sidebar stays quiet mid-run.
 * Includes operational fields that change lane classification.
 */
export function inboxSessionFingerprint(session: Session): string {
  const g = session.gitSummary;
  // Bucket updatedAt to ~30s so relative times refresh without per-event churn.
  const updatedBucket = Math.floor((session.updatedAt || 0) / 30_000);
  return [
    session.id,
    session.status,
    session.name,
    session.source,
    session.config?.cwd ?? "",
    session.metrics?.filesChanged ?? 0,
    session.metrics?.errorCount ?? 0,
    g?.conflictCount ?? 0,
    g?.stagedCount ?? 0,
    g?.unstagedCount ?? 0,
    g?.untrackedCount ?? 0,
    g?.branch ?? "",
    session.hydratePartial ? "1" : "0",
    session.restoreState ?? "",
    session.restoreError ?? "",
    session.backgroundJob ? "1" : "0",
    updatedBucket,
  ].join(":");
}

export function inboxJobsFingerprint(jobs: AutomationJob[]): string {
  return jobs
    .map(
      (j) =>
        `${j.id}:${j.sessionId ?? ""}:${j.status}:${j.priority}:${j.branch ?? ""}:${j.worktreePath ?? ""}`
    )
    .sort()
    .join("|");
}
