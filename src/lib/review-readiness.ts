/**
 * Pre-commit / PR readiness checklist for the Review workbench.
 * Pure functions — unit-tested, reused by Changes and Review UI.
 *
 * Lifecycle labels come from the versioned inbox / session-lifecycle-projection
 * contract. Process exit, task (job) outcome, review readiness, and Git commit
 * readiness stay distinct layers — contradictions never become optimistic success.
 */

import type { AutomationJob } from "./automation/types";
import {
  INBOX_LIFECYCLE_PRESENTATION_VERSION,
  processStatusLabel,
  projectRunLifecycle,
  type InboxLane,
  type InboxReasonSource,
  type LifecyclePresentationTone,
} from "./session-lifecycle-projection";
import type { Session, SessionStatus } from "./types";
import { buildValidationLane } from "./validation-lane";
import { buildReviewQueue } from "./review-queue";
import { jobStatusLabel } from "./automation/queue";

export type ChecklistSeverity = "ok" | "warn" | "block" | "info";

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  severity: ChecklistSeverity;
  /** When true, commit should be discouraged or blocked in UI. */
  blocksCommit?: boolean;
}

/**
 * Single safest next action for the review surface.
 * Distinct from process exit and from durable handoff commit/push/PR outcomes.
 */
export type ReviewNextActionId =
  | "wait"
  | "inspect_state"
  | "review_findings"
  | "validate"
  | "stage"
  | "commit"
  | "open_handoff"
  | "none";

export interface ReviewNextAction {
  id: ReviewNextActionId;
  label: string;
  detail: string;
  disabled: boolean;
}

export interface ReviewReadiness {
  items: ChecklistItem[];
  /**
   * Git index is free of hard blockers (conflicts / isolation / empty stage).
   * False when lifecycle claims contradict — never optimistic success.
   */
  readyToCommit: boolean;
  readyToPush: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  unresolvedComments: number;
  secretFiles: number;
  conflictCount: number;
  summary: string;

  // ── Lifecycle layers (session-lifecycle-projection / inbox) ──────────────
  lifecycleVersion: typeof INBOX_LIFECYCLE_PRESENTATION_VERSION;
  lane: InboxLane;
  laneLabel: string;
  tone: LifecyclePresentationTone;
  /** Process layer — runtime status; never equated to review readiness. */
  processStatus: SessionStatus | null;
  processLabel: string | null;
  /** Task / job layer when linked. */
  jobStatus: AutomationJob["status"] | null;
  taskLabel: string | null;
  /**
   * Review-readiness layer: true only when lifecycle places the session in
   * ready_review and claims are non-diagnostic. Process exit alone is not enough.
   */
  reviewReady: boolean;
  reviewLabel: string;
  /** Validation layer — distinct from review findings and Git handoff. */
  validationLabel: string;
  validationNeedsAttention: boolean;
  reason: string;
  reasonSource: InboxReasonSource;
  isDiagnostic: boolean;
  /** Exactly one safest next action for the review surface. */
  nextAction: ReviewNextAction;
}

function gitCounts(session: Session) {
  const files = Object.values(session.files);
  const stagedCount =
    session.gitSummary?.stagedCount ?? files.filter((f) => f.staged).length;
  const unstagedCount =
    session.gitSummary?.unstagedCount ??
    files.filter((f) => f.unstaged).length;
  const untrackedCount =
    session.gitSummary?.untrackedCount ??
    files.filter((f) => f.untracked).length;
  const conflictCount =
    session.gitSummary?.conflictCount ??
    files.filter((f) => f.conflict).length;
  return { stagedCount, unstagedCount, untrackedCount, conflictCount, files };
}

function reviewLayerLabel(
  reviewReady: boolean,
  isDiagnostic: boolean,
  issueCount: number,
  conflictCount: number
): string {
  if (isDiagnostic) return "Review blocked by diagnostic";
  if (conflictCount > 0) return "Review blocked by conflicts";
  if (issueCount > 0) return `${issueCount} finding${issueCount === 1 ? "" : "s"} need attention`;
  if (reviewReady) return "Ready for review";
  return "Not review-ready";
}

function validationLayerLabel(
  failed: number,
  blocked: number,
  total: number,
  needsAttention: boolean
): string {
  if (needsAttention) {
    const parts: string[] = [];
    if (failed > 0) parts.push(`${failed} failed`);
    if (blocked > 0) parts.push(`${blocked} blocked`);
    return parts.length ? `Validation · ${parts.join(" · ")}` : "Validation needs attention";
  }
  if (total === 0) return "Validation · no checks yet";
  return `Validation · ${total} recorded`;
}

function pickReviewNextAction(input: {
  isDiagnostic: boolean;
  isLive: boolean;
  issueCount: number;
  conflictCount: number;
  validationNeedsAttention: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  gitReadyToCommit: boolean;
  reviewReady: boolean;
}): ReviewNextAction {
  if (input.isDiagnostic) {
    return {
      id: "inspect_state",
      label: "Inspect state",
      detail:
        "Process and task claims disagree — resolve the diagnostic before treating work as review-ready or handing off.",
      disabled: false,
    };
  }
  if (input.isLive) {
    return {
      id: "wait",
      label: "Wait for run",
      detail: "Review readiness unlocks when the active process reaches a terminal state.",
      disabled: true,
    };
  }
  if (input.conflictCount > 0 || input.issueCount > 0) {
    return {
      id: "review_findings",
      label:
        input.conflictCount > 0
          ? "Resolve conflicts"
          : `Inspect ${input.issueCount} finding${input.issueCount === 1 ? "" : "s"}`,
      detail: "Clear review findings and conflicts before Git handoff.",
      disabled: false,
    };
  }
  if (input.validationNeedsAttention) {
    return {
      id: "validate",
      label: "Review validation",
      detail: "Failed or blocked checks must be understood before commit/push claims.",
      disabled: false,
    };
  }
  if (input.stagedCount === 0 && input.unstagedCount + input.untrackedCount > 0) {
    return {
      id: "stage",
      label: "Stage changes",
      detail: "Stage reviewed work, then write a confirmation-gated commit.",
      disabled: false,
    };
  }
  if (input.gitReadyToCommit && input.stagedCount > 0) {
    return {
      id: "commit",
      label: "Commit staged work",
      detail: "Review readiness is satisfied for handoff — open the commit path next.",
      disabled: false,
    };
  }
  if (input.reviewReady) {
    return {
      id: "open_handoff",
      label: "Open handoff",
      detail: "Process exited with reviewable work — continue on the Git completion path.",
      disabled: false,
    };
  }
  return {
    id: "none",
    label: "No review action",
    detail: "No reviewable work or Git handoff step is ready.",
    disabled: true,
  };
}

/**
 * Build a commit/PR readiness checklist from session state.
 * Optional linked job feeds the canonical lifecycle projection for diagnostics.
 */
export function buildReviewReadiness(
  session: Session,
  job?: AutomationJob | null
): ReviewReadiness {
  const { stagedCount, unstagedCount, untrackedCount, conflictCount, files } =
    gitCounts(session);
  const comments = session.reviewComments ?? [];
  const unresolvedComments = comments.filter((c) => !c.resolved).length;
  const secretFiles = files.filter((f) => f.isSecret).length;
  const isLive =
    session.status === "running" || session.status === "starting";
  const isolationBlocked =
    !!session.config.isolationGuard &&
    !!session.config.mainCheckout &&
    session.config.cwd === session.config.mainCheckout;

  // Canonical lifecycle — process / job / review lane / diagnostic.
  const lifecycle = projectRunLifecycle(session, job ?? null);
  const isDiagnostic = lifecycle.isDiagnostic;
  const reviewReady =
    !isDiagnostic && lifecycle.lane === "ready_review";

  const queue = buildReviewQueue(session);
  const issueCount = queue.issues.length;
  const validation = buildValidationLane(session).summary;
  const validationNeedsAttention = validation.needsAttention;

  const items: ChecklistItem[] = [];

  if (isDiagnostic) {
    items.push({
      id: "lifecycle",
      label: "Lifecycle",
      detail: lifecycle.reason,
      severity: "block",
      blocksCommit: true,
    });
  }

  if (conflictCount > 0) {
    items.push({
      id: "conflicts",
      label: "Merge conflicts",
      detail: `${conflictCount} conflicted path(s) — resolve before commit`,
      severity: "block",
      blocksCommit: true,
    });
  } else {
    items.push({
      id: "conflicts",
      label: "Merge conflicts",
      detail: "None",
      severity: "ok",
    });
  }

  if (stagedCount === 0) {
    items.push({
      id: "staged",
      label: "Staged files",
      detail: "Nothing staged",
      severity: "block",
      blocksCommit: true,
    });
  } else {
    items.push({
      id: "staged",
      label: "Staged files",
      detail: `${stagedCount} ready to commit`,
      severity: "ok",
    });
  }

  if (unstagedCount + untrackedCount > 0) {
    items.push({
      id: "unstaged",
      label: "Unstaged / untracked",
      detail: `${unstagedCount} modified · ${untrackedCount} untracked`,
      severity: "warn",
    });
  } else {
    items.push({
      id: "unstaged",
      label: "Unstaged / untracked",
      detail: "Working tree clean beyond staged",
      severity: "ok",
    });
  }

  if (unresolvedComments > 0) {
    items.push({
      id: "comments",
      label: "Review comments",
      detail: `${unresolvedComments} unresolved`,
      severity: "warn",
    });
  } else if (comments.length > 0) {
    items.push({
      id: "comments",
      label: "Review comments",
      detail: `${comments.length} resolved`,
      severity: "ok",
    });
  } else {
    items.push({
      id: "comments",
      label: "Review comments",
      detail: "None",
      severity: "info",
    });
  }

  if (secretFiles > 0) {
    items.push({
      id: "secrets",
      label: "Secret paths",
      detail: `${secretFiles} path(s) look like credentials — review carefully`,
      severity: "warn",
    });
  } else {
    items.push({
      id: "secrets",
      label: "Secret paths",
      detail: "None flagged",
      severity: "ok",
    });
  }

  // Process layer only — never label process exit as review success.
  const processLabel = processStatusLabel(session.status);
  if (isLive) {
    items.push({
      id: "run",
      label: "Process",
      detail: processLabel ?? "Process running",
      severity: "warn",
    });
  } else if (session.status === "error") {
    items.push({
      id: "run",
      label: "Process",
      detail: processLabel ?? "Process error",
      severity: "warn",
    });
  } else {
    items.push({
      id: "run",
      label: "Process",
      detail: processLabel ?? session.status,
      severity: "ok",
    });
  }

  // Task layer when a job is linked — distinct from process.
  if (job) {
    items.push({
      id: "task",
      label: "Task",
      detail: jobStatusLabel(job.status),
      severity: isDiagnostic
        ? "block"
        : job.status === "failed"
          ? "warn"
          : "info",
      blocksCommit: isDiagnostic ? true : undefined,
    });
  }

  // Review layer — not the same as process exit or Git staged readiness.
  items.push({
    id: "review_layer",
    label: "Review readiness",
    detail: reviewLayerLabel(reviewReady, isDiagnostic, issueCount, conflictCount),
    severity: isDiagnostic
      ? "block"
      : issueCount > 0 || conflictCount > 0
        ? "warn"
        : reviewReady
          ? "ok"
          : "info",
  });

  items.push({
    id: "validation_layer",
    label: "Validation",
    detail: validationLayerLabel(
      validation.failed,
      validation.blocked,
      validation.total,
      validationNeedsAttention
    ),
    severity: validationNeedsAttention ? "warn" : validation.total > 0 ? "ok" : "info",
  });

  if (isolationBlocked) {
    items.push({
      id: "isolation",
      label: "Worktree isolation",
      detail: "Writes blocked on main checkout — hand off to worktree",
      severity: "block",
      blocksCommit: true,
    });
  }

  const branch = session.gitSummary?.branch;
  if (branch) {
    const ahead = session.gitSummary?.ahead ?? 0;
    const behind = session.gitSummary?.behind ?? 0;
    items.push({
      id: "branch",
      label: "Branch",
      detail:
        behind > 0
          ? `${branch} · ${behind} behind upstream`
          : ahead > 0
            ? `${branch} · ${ahead} ahead`
            : branch,
      severity: behind > 0 ? "warn" : "info",
    });
  }

  // Diagnostic inserts a blocksCommit item — never optimistic success.
  const readyToCommit = !items.some((i) => i.blocksCommit);
  const readyToPush =
    readyToCommit &&
    (session.gitSummary?.ahead ?? 0) >= 0 &&
    !isLive &&
    !isDiagnostic;

  const nextAction = pickReviewNextAction({
    isDiagnostic,
    isLive,
    issueCount,
    conflictCount,
    validationNeedsAttention,
    stagedCount,
    unstagedCount,
    untrackedCount,
    gitReadyToCommit: readyToCommit,
    reviewReady,
  });

  let summary: string;
  if (isDiagnostic) {
    summary = `Needs attention · ${lifecycle.reason}`;
  } else if (!readyToCommit) {
    const blockers = items.filter((i) => i.blocksCommit).map((i) => i.label);
    summary =
      blockers.length > 0
        ? `Not ready: ${blockers.join(", ")}`
        : "Not ready";
  } else if (items.some((i) => i.severity === "warn")) {
    summary = "Ready with warnings";
  } else {
    summary = "Ready to commit";
  }

  return {
    items,
    readyToCommit,
    readyToPush,
    stagedCount,
    unstagedCount,
    untrackedCount,
    unresolvedComments,
    secretFiles,
    conflictCount,
    summary,
    lifecycleVersion: lifecycle.lifecycleVersion,
    lane: lifecycle.lane,
    laneLabel: lifecycle.laneLabel,
    tone: lifecycle.tone,
    processStatus: lifecycle.processStatus,
    processLabel: lifecycle.processLabel,
    jobStatus: lifecycle.jobStatus,
    taskLabel: lifecycle.jobLabel,
    reviewReady,
    reviewLabel: reviewLayerLabel(
      reviewReady,
      isDiagnostic,
      issueCount,
      conflictCount
    ),
    validationLabel: validationLayerLabel(
      validation.failed,
      validation.blocked,
      validation.total,
      validationNeedsAttention
    ),
    validationNeedsAttention,
    reason: lifecycle.reason,
    reasonSource: lifecycle.reasonSource,
    isDiagnostic,
    nextAction,
  };
}
