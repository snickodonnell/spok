import { buildReviewQueue } from "./review-queue";
import { buildValidationLane } from "./validation-lane";
import { redactSecrets } from "./security/secrets";
import { jobStatusLabel } from "./automation/queue";
import type { AutomationJob } from "./automation/types";
import {
  processStatusLabel,
  type InboxReasonSource,
} from "./session-lifecycle-projection";
import type {
  HandoffOutcomeAction,
  HandoffOutcomeRecord,
  HandoffOutcomeState,
  HandoffReadinessSnapshot,
  Session,
} from "./types";

export interface HandoffOutcomeEvent {
  action: HandoffOutcomeAction;
  ok: boolean;
  recordedAt?: number;
  auditId?: string;
  error?: string;
  commit?: { oid?: string; summary?: string };
  push?: { remote?: string; branch?: string };
  pullRequest?: { url?: string; number?: number };
}

/**
 * Distinct layer labels for durable handoff evidence and live projection.
 * Process exit ≠ review readiness ≠ validation ≠ Git handoff stage.
 */
export interface HandoffLayerLabels {
  processLabel: string | null;
  taskLabel: string | null;
  reviewLabel: string;
  validationLabel: string;
  handoffLabel: string;
  isDiagnostic: boolean;
  reason: string;
  reasonSource: InboxReasonSource;
}

function cleanOptional(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

export function sanitizeHandoffFailure(value: string | undefined): string {
  const clipped = (value || "Handoff action failed").replace(/\s+/g, " ").trim().slice(0, 500);
  return redactSecrets(clipped).text;
}

/**
 * Project process / task / review / validation / handoff labels without
 * collapsing them. Pure helper shared by handoff-flow and tests.
 */
export function projectHandoffLayerLabels(input: {
  session: Session;
  job?: AutomationJob | null;
  reviewReady: boolean;
  reviewIssueCount: number;
  validationNeedsAttention: boolean;
  validationFailed: number;
  validationBlocked: number;
  validationTotal: number;
  handoffLabel: string;
  isDiagnostic: boolean;
  reason: string;
  reasonSource: InboxReasonSource;
}): HandoffLayerLabels {
  const processLabel = processStatusLabel(input.session.status);
  const taskLabel = input.job ? jobStatusLabel(input.job.status) : null;

  let reviewLabel: string;
  if (input.isDiagnostic) {
    reviewLabel = "Review blocked by diagnostic";
  } else if (input.reviewIssueCount > 0) {
    reviewLabel = `${input.reviewIssueCount} finding${
      input.reviewIssueCount === 1 ? "" : "s"
    } need attention`;
  } else if (input.reviewReady) {
    reviewLabel = "Ready for review";
  } else {
    reviewLabel = "Not review-ready";
  }

  let validationLabel: string;
  if (input.validationNeedsAttention) {
    const parts: string[] = [];
    if (input.validationFailed > 0) {
      parts.push(`${input.validationFailed} failed`);
    }
    if (input.validationBlocked > 0) {
      parts.push(`${input.validationBlocked} blocked`);
    }
    validationLabel = parts.length
      ? `Validation · ${parts.join(" · ")}`
      : "Validation needs attention";
  } else if (input.validationTotal === 0) {
    validationLabel = "Validation · no checks yet";
  } else {
    validationLabel = `Validation · ${input.validationTotal} recorded`;
  }

  return {
    processLabel,
    taskLabel,
    reviewLabel,
    validationLabel,
    handoffLabel: input.handoffLabel,
    isDiagnostic: input.isDiagnostic,
    reason: input.reason,
    reasonSource: input.reasonSource,
  };
}

export function captureHandoffReadiness(
  session: Session,
  capturedAt = Date.now()
): HandoffReadinessSnapshot {
  const git = session.gitSummary;
  const files = Object.values(session.files);
  const staged = git?.stagedCount ?? files.filter((file) => file.staged).length;
  const unstaged = git?.unstagedCount ?? files.filter((file) => file.unstaged).length;
  const untracked = git?.untrackedCount ?? files.filter((file) => file.untracked).length;
  const conflicts = git?.conflictCount ?? files.filter((file) => file.conflict).length;
  const validation = buildValidationLane(session).summary;
  // sessionStatus is the process layer only — not review readiness or handoff state.
  return {
    capturedAt,
    sessionStatus: session.status,
    reviewIssueCount: buildReviewQueue(session).issues.length,
    unresolvedComments: (session.reviewComments ?? []).filter((comment) => !comment.resolved).length,
    validationTotal: validation.total,
    validationPassed: validation.success,
    validationFailed: validation.failed,
    validationBlocked: validation.blocked,
    dirtyCount: staged + unstaged + untracked,
    conflictCount: conflicts,
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    clean: git?.clean ?? staged + unstaged + untracked + conflicts === 0,
    headOid: cleanOptional(git?.headOid),
  };
}

function stateForSuccess(action: HandoffOutcomeAction): HandoffOutcomeState {
  if (action === "commit") return "committed";
  if (action === "push") return "published";
  return "pull_request";
}

/** Merge one confirmed, audited Git result into the durable handoff record. */
export function advanceHandoffOutcome(input: {
  session: Session;
  jobId?: string;
  event: HandoffOutcomeEvent;
}): HandoffOutcomeRecord {
  const { session, event } = input;
  const recordedAt = event.recordedAt ?? Date.now();
  const previous = session.handoffOutcome;
  const base: HandoffOutcomeRecord = {
    version: 1,
    id: previous?.id ?? `handoff-${session.id}`,
    sessionId: session.id,
    jobId: cleanOptional(input.jobId) ?? previous?.jobId,
    branch: cleanOptional(session.gitSummary?.branch) ?? previous?.branch,
    worktreePath: cleanOptional(session.config.worktreePath) ?? previous?.worktreePath,
    mainCheckout: cleanOptional(session.config.mainCheckout) ?? previous?.mainCheckout,
    // Handoff outcome state is Git-stage only — not process exit or review readiness.
    state: event.ok ? stateForSuccess(event.action) : "failed",
    createdAt: previous?.createdAt ?? recordedAt,
    updatedAt: recordedAt,
    readiness: captureHandoffReadiness(session, recordedAt),
    commit: previous?.commit,
    push: previous?.push,
    pullRequest: previous?.pullRequest,
  };

  if (!event.ok) {
    return {
      ...base,
      failure: {
        action: event.action,
        message: sanitizeHandoffFailure(event.error),
        recordedAt,
        auditId: cleanOptional(event.auditId),
      },
    };
  }

  const next = { ...base };
  if (event.action === "commit") {
    const oid = cleanOptional(event.commit?.oid) ?? cleanOptional(session.gitSummary?.headOid);
    if (oid) {
      next.commit = {
        oid,
        summary: cleanOptional(event.commit?.summary),
        recordedAt,
        auditId: cleanOptional(event.auditId),
      };
    }
  } else if (event.action === "push") {
    next.push = {
      remote: cleanOptional(event.push?.remote),
      branch: cleanOptional(event.push?.branch) ?? cleanOptional(session.gitSummary?.branch),
      recordedAt,
      auditId: cleanOptional(event.auditId),
    };
  } else {
    next.pullRequest = {
      url: cleanOptional(event.pullRequest?.url),
      number: event.pullRequest?.number,
      recordedAt,
      auditId: cleanOptional(event.auditId),
    };
  }
  return next;
}
