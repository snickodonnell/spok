import { buildReviewQueue } from "./review-queue";
import { buildValidationLane } from "./validation-lane";
import { redactSecrets } from "./security/secrets";
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

function cleanOptional(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

export function sanitizeHandoffFailure(value: string | undefined): string {
  const clipped = (value || "Handoff action failed").replace(/\s+/g, " ").trim().slice(0, 500);
  return redactSecrets(clipped).text;
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
