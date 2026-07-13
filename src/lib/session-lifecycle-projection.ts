/**
 * Session lifecycle projection for Monitor + Run surfaces.
 *
 * Thin adapter over the versioned inbox lifecycle contract
 * (`session-inbox.ts`). Keeps process status, job status, review readiness,
 * and diagnostic contradiction as distinct layers — never collapses them into
 * an optimistic success badge.
 */

import { jobStatusLabel } from "./automation/queue";
import type { AutomationJob } from "./automation/types";
import {
  INBOX_LANE_META,
  INBOX_LIFECYCLE_PRESENTATION_VERSION,
  jobToInboxEntry,
  toInboxEntry,
  type InboxEntry,
  type InboxLane,
  type InboxNextAction,
  type InboxReasonSource,
} from "./session-inbox";
import type { Session, SessionStatus } from "./types";

export type LifecyclePresentationTone =
  | "running"
  | "queued"
  | "attention"
  | "failed"
  | "review"
  | "finished"
  | "ready";

/**
 * Canonical UI projection shared by Run status card and Monitor job rows.
 * Derived only from inbox classification — no parallel state machine.
 */
export type SessionLifecycleProjection = {
  lifecycleVersion: typeof INBOX_LIFECYCLE_PRESENTATION_VERSION;
  entryId: string;
  lane: InboxLane;
  laneLabel: string;
  laneShort: string;
  /** Process layer — session runtime status when a session exists. */
  processStatus: SessionStatus | null;
  processLabel: string | null;
  /** Job layer — automation job status when linked. */
  jobStatus: AutomationJob["status"] | null;
  jobLabel: string | null;
  reason: string;
  reasonSource: InboxReasonSource;
  /** Exactly one safest next navigation action. */
  nextAction: InboxNextAction;
  /** Durable claims contradict — never present as success. */
  isDiagnostic: boolean;
  /**
   * Primary badge label for the operational lane.
   * Diagnostics always surface as needs-attention, never "Completed".
   */
  badgeLabel: string;
  tone: LifecyclePresentationTone;
  sessionId: string;
  jobId?: string;
};

function toneFor(
  lane: InboxLane,
  isDiagnostic: boolean
): LifecyclePresentationTone {
  if (isDiagnostic) return "attention";
  switch (lane) {
    case "running":
      return "running";
    case "queued":
      return "queued";
    case "waiting":
      return "attention";
    case "failed":
      return "failed";
    case "ready_review":
      return "review";
    case "finished":
      return "finished";
    case "idle":
      return "ready";
    default:
      return "ready";
  }
}

/** Process-layer label — distinct from task outcome / review readiness. */
export function processStatusLabel(
  status: SessionStatus | null | undefined
): string | null {
  if (!status) return null;
  switch (status) {
    case "running":
      return "Process running";
    case "starting":
      return "Process starting";
    case "completed":
      return "Process exited";
    case "error":
      return "Process error";
    case "stopped":
      return "Process stopped";
    case "paused":
      return "Process paused";
    case "ready":
      return "Process ready";
    case "idle":
      return "Process idle";
    default:
      return status;
  }
}

function badgeLabelFor(entry: InboxEntry, isDiagnostic: boolean): string {
  if (isDiagnostic) return "Needs attention";
  return INBOX_LANE_META[entry.lane].label;
}

function fromEntry(
  entry: InboxEntry,
  processStatus: SessionStatus | null
): SessionLifecycleProjection {
  const isDiagnostic = entry.reasonSource === "diagnostic";
  const meta = INBOX_LANE_META[entry.lane];
  return {
    lifecycleVersion: entry.lifecycleVersion,
    entryId: entry.entryId,
    lane: entry.lane,
    laneLabel: meta.label,
    laneShort: meta.short,
    processStatus,
    processLabel: processStatusLabel(processStatus),
    jobStatus: entry.jobStatus ?? null,
    jobLabel: entry.jobStatus ? jobStatusLabel(entry.jobStatus) : null,
    reason: entry.reason,
    reasonSource: entry.reasonSource,
    nextAction: entry.nextAction,
    isDiagnostic,
    badgeLabel: badgeLabelFor(entry, isDiagnostic),
    tone: toneFor(entry.lane, isDiagnostic),
    sessionId: entry.sessionId,
    jobId: entry.jobId,
  };
}

/**
 * Prefer active linked jobs when multiple jobs share a session
 * (same ranking spirit as session-inbox `jobBySessionId`).
 */
export function findLinkedJob(
  sessionId: string,
  jobs: AutomationJob[] | undefined
): AutomationJob | null {
  if (!jobs?.length) return null;
  const rank = (status: AutomationJob["status"]) => {
    switch (status) {
      case "waiting_approval":
        return 0;
      case "running":
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
  let best: AutomationJob | null = null;
  for (const job of jobs) {
    if (job.sessionId !== sessionId) continue;
    if (!best || rank(job.status) < rank(best.status)) {
      best = job;
    }
  }
  return best;
}

/** Project lifecycle for the Run status card (active session + optional job). */
export function projectRunLifecycle(
  session: Session,
  job?: AutomationJob | null
): SessionLifecycleProjection {
  return fromEntry(toInboxEntry(session, job ?? null), session.status);
}

/** Project lifecycle for a Monitor job row (job + optional session body). */
export function projectJobLifecycle(
  job: AutomationJob,
  session?: Session | null
): SessionLifecycleProjection {
  if (session) {
    return fromEntry(toInboxEntry(session, job), session.status);
  }
  return fromEntry(jobToInboxEntry(job), null);
}

export {
  INBOX_LANE_META,
  INBOX_LIFECYCLE_PRESENTATION_VERSION,
  type InboxLane,
  type InboxNextAction,
  type InboxReasonSource,
};
