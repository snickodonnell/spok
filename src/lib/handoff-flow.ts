/**
 * Pure completion-flow derivation for the Review workbench.
 *
 * This intentionally describes existing, policy-gated Git actions. Durable
 * handoff evidence is historical context only; fresh Git/session state always
 * reconstructs the next action and the record never grants authority.
 *
 * Process, task (job), review readiness, validation, and Git handoff stages
 * remain distinct. Lifecycle labels reuse session-lifecycle-projection / inbox
 * classification — contradictions never become optimistic handoff success.
 */

import type { AutomationJob } from "./automation/types";
import { buildReviewQueue } from "./review-queue";
import {
  INBOX_LIFECYCLE_PRESENTATION_VERSION,
  projectRunLifecycle,
  type InboxLane,
  type InboxReasonSource,
  type LifecyclePresentationTone,
} from "./session-lifecycle-projection";
import type { HandoffOutcomeRecord, Session, SessionStatus } from "./types";
import { buildValidationLane } from "./validation-lane";
import {
  projectHandoffLayerLabels,
  type HandoffLayerLabels,
} from "./handoff-record";

export type HandoffStepId = "review" | "commit" | "push" | "pr";
export type HandoffStepStatus = "complete" | "active" | "blocked" | "pending";
export type HandoffActionId =
  | "wait"
  | "review"
  | "stage"
  | "commit"
  | "pull"
  | "push"
  | "create_pr"
  | "none";

export interface HandoffStep {
  id: HandoffStepId;
  label: string;
  detail: string;
  status: HandoffStepStatus;
}

export interface HandoffAction {
  id: HandoffActionId;
  label: string;
  detail: string;
  disabled: boolean;
  privileged: boolean;
}

/**
 * Distinct lifecycle layers projected beside the Git handoff step rail.
 * Never collapse process exit into review readiness or commit/push success.
 */
export interface HandoffLifecycleProjection {
  lifecycleVersion: typeof INBOX_LIFECYCLE_PRESENTATION_VERSION;
  lane: InboxLane;
  laneLabel: string;
  tone: LifecyclePresentationTone;
  processStatus: SessionStatus | null;
  processLabel: string | null;
  jobStatus: AutomationJob["status"] | null;
  taskLabel: string | null;
  reviewReady: boolean;
  reviewLabel: string;
  validationLabel: string;
  validationNeedsAttention: boolean;
  /** Active Git handoff stage label (commit/push/PR), not review readiness. */
  handoffLabel: string;
  layers: HandoffLayerLabels;
  reason: string;
  reasonSource: InboxReasonSource;
  isDiagnostic: boolean;
}

export interface HandoffFlow {
  steps: HandoffStep[];
  nextAction: HandoffAction;
  headline: string;
  issueCount: number;
  dirtyCount: number;
  stagedCount: number;
  branch: string | null;
  workspaceLabel: string;
  /** Historical evidence only; nextAction always comes from fresh session/Git state. */
  outcome: HandoffOutcomeRecord | null;
  /** Canonical lifecycle layers — process / task / review / validation / handoff. */
  lifecycle: HandoffLifecycleProjection;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function activeHandoffStageLabel(
  steps: HandoffStep[],
  nextAction: HandoffAction,
  isDiagnostic: boolean
): string {
  if (isDiagnostic) return "Handoff blocked · diagnostic";
  if (nextAction.id === "wait") return "Handoff waiting · process active";
  if (nextAction.id === "none") return "No handoff work";
  const active = steps.find((s) => s.status === "active");
  if (active) return `Handoff · ${active.label}`;
  if (nextAction.id === "create_pr") return "Handoff · Pull request";
  if (nextAction.id === "push" || nextAction.id === "pull") return "Handoff · Push";
  if (nextAction.id === "commit" || nextAction.id === "stage") return "Handoff · Commit";
  if (nextAction.id === "review") return "Handoff · Review findings";
  return "Handoff pending";
}

export function buildHandoffFlow(
  session: Session,
  job?: AutomationJob | null
): HandoffFlow {
  const git = session.gitSummary;
  const stagedCount = git?.stagedCount ??
    Object.values(session.files).filter((file) => file.staged).length;
  const unstagedCount = git?.unstagedCount ??
    Object.values(session.files).filter((file) => file.unstaged).length;
  const untrackedCount = git?.untrackedCount ??
    Object.values(session.files).filter((file) => file.untracked).length;
  const conflictCount = git?.conflictCount ??
    Object.values(session.files).filter((file) => file.conflict).length;
  const dirtyCount = stagedCount + unstagedCount + untrackedCount;
  const queue = buildReviewQueue(session);
  const issueCount = queue.issues.length;
  const isLive = session.status === "running" || session.status === "starting";
  const hasHandoffWork = dirtyCount > 0 || (git?.ahead ?? 0) > 0;
  const commitComplete = dirtyCount === 0 && (git?.ahead ?? 0) > 0;
  // A clean synchronized branch is the PR-ready state.
  const synchronized =
    dirtyCount === 0 && !!git?.upstream && (git?.ahead ?? 0) === 0;
  const prReady =
    synchronized &&
    !!git?.branch &&
    !/^(main|master)$/i.test(git.branch);

  const lifecycleBase = projectRunLifecycle(session, job ?? null);
  const isDiagnostic = lifecycleBase.isDiagnostic;
  const validation = buildValidationLane(session).summary;
  const validationNeedsAttention = validation.needsAttention;
  const reviewReady =
    !isDiagnostic && lifecycleBase.lane === "ready_review";

  let nextAction: HandoffAction;
  if (isDiagnostic) {
    // Contradictory durable claims — never unlock Git write as success.
    nextAction = {
      id: "review",
      label: "Inspect state",
      detail:
        "Process and task claims disagree. Resolve the diagnostic before commit, push, or PR.",
      disabled: false,
      privileged: false,
    };
  } else if (isLive) {
    nextAction = {
      id: "wait",
      label: "Agent is still working",
      detail: "Handoff actions unlock when the active run reaches a terminal state.",
      disabled: true,
      privileged: false,
    };
  } else if (issueCount > 0 || conflictCount > 0) {
    nextAction = {
      id: "review",
      label: `Inspect ${plural(Math.max(issueCount, conflictCount), "finding")}`,
      detail: "Open the highest-priority finding before deciding whether to hand off.",
      disabled: false,
      privileged: false,
    };
  } else if (validationNeedsAttention) {
    nextAction = {
      id: "review",
      label: "Review validation",
      detail:
        "Failed or blocked validation is distinct from Git handoff — inspect checks first.",
      disabled: false,
      privileged: false,
    };
  } else if (stagedCount > 0) {
    nextAction = {
      id: "commit",
      label: `Write message for ${plural(stagedCount, "staged file")}`,
      detail: "The commit remains confirmation-gated and uses only the staged index.",
      disabled: false,
      privileged: true,
    };
  } else if (unstagedCount + untrackedCount > 0) {
    nextAction = {
      id: "stage",
      label: `Stage ${plural(unstagedCount + untrackedCount, "change")}`,
      detail: "Review the file list, then stage the work you intend to hand off.",
      disabled: false,
      privileged: true,
    };
  } else if ((git?.behind ?? 0) > 0) {
    nextAction = {
      id: "pull",
      label: `Sync ${plural(git?.behind ?? 0, "upstream commit")}`,
      detail: "Spok uses fast-forward-only pull and refuses an implicit merge.",
      disabled: false,
      privileged: true,
    };
  } else if ((git?.ahead ?? 0) > 0 || (hasHandoffWork && !git?.upstream)) {
    nextAction = {
      id: "push",
      label: `Push ${plural(Math.max(git?.ahead ?? 0, 1), "commit")}`,
      detail: git?.upstream
        ? `Publish the current branch to ${git.upstream}.`
        : "Publish the branch and establish its upstream.",
      disabled: false,
      privileged: true,
    };
  } else if (prReady) {
    nextAction = {
      id: "create_pr",
      label: "Prepare pull request",
      detail: "Fill a PR draft from the trace-linked review summary.",
      disabled: false,
      privileged: true,
    };
  } else {
    nextAction = {
      id: "none",
      label: "No changes to hand off",
      detail: "Run an agent task or refresh Git status when work is available.",
      disabled: true,
      privileged: false,
    };
  }

  const reviewStatus: HandoffStepStatus = isDiagnostic
    ? "blocked"
    : isLive
      ? "blocked"
      : issueCount > 0 || conflictCount > 0 || validationNeedsAttention
        ? "active"
        : hasHandoffWork || prReady
          ? "complete"
          : "pending";
  const commitStatus: HandoffStepStatus = isDiagnostic
    ? "blocked"
    : dirtyCount === 0 && ((git?.ahead ?? 0) > 0 || prReady)
      ? "complete"
      : reviewStatus === "complete" && dirtyCount > 0
        ? "active"
        : reviewStatus === "active" || reviewStatus === "blocked"
          ? "blocked"
          : "pending";
  const pushStatus: HandoffStepStatus = isDiagnostic
    ? "blocked"
    : prReady
      ? "complete"
      : commitComplete
        ? "active"
        : commitStatus === "blocked"
          ? "blocked"
          : "pending";
  const prStatus: HandoffStepStatus = isDiagnostic
    ? "blocked"
    : prReady
      ? "active"
      : "pending";

  const steps: HandoffStep[] = [
    {
      id: "review",
      label: "Review",
      detail: isDiagnostic
        ? "Lifecycle diagnostic"
        : isLive
          ? "Run in progress"
          : validationNeedsAttention
            ? "Validation needs attention"
            : issueCount > 0
              ? plural(issueCount, "finding")
              : `${plural(queue.summary.total, "file")} checked`,
      status: reviewStatus,
    },
    {
      id: "commit",
      label: "Commit",
      detail:
        stagedCount > 0
          ? plural(stagedCount, "file") + " staged"
          : dirtyCount > 0
            ? plural(dirtyCount, "change") + " unstaged"
            : commitStatus === "complete"
              ? "Working tree clean"
              : "Waiting for changes",
      status: commitStatus,
    },
    {
      id: "push",
      label: "Push",
      detail: prReady
        ? "Up to date"
        : (git?.behind ?? 0) > 0
          ? `${git?.behind} behind`
          : (git?.ahead ?? 0) > 0
            ? `${git?.ahead} ahead`
            : git?.upstream
              ? "No local commits"
              : "No upstream",
      status: pushStatus,
    },
    {
      id: "pr",
      label: "Pull request",
      detail: prReady ? "Ready to draft" : "After push",
      status: prStatus,
    },
  ];

  const handoffLabel = activeHandoffStageLabel(steps, nextAction, isDiagnostic);
  const layers = projectHandoffLayerLabels({
    session,
    job: job ?? null,
    reviewReady,
    reviewIssueCount: issueCount,
    validationNeedsAttention,
    validationFailed: validation.failed,
    validationBlocked: validation.blocked,
    validationTotal: validation.total,
    handoffLabel,
    isDiagnostic,
    reason: lifecycleBase.reason,
    reasonSource: lifecycleBase.reasonSource,
  });

  const headline = isDiagnostic
    ? `Needs attention · ${lifecycleBase.reason}`
    : isLive
      ? "Handoff waits for the active run"
      : issueCount > 0
        ? `${plural(issueCount, "finding")} need attention`
        : validationNeedsAttention
          ? "Validation needs attention before handoff"
          : prReady
            ? "Branch is ready for a pull request"
            : dirtyCount > 0
              ? "Move reviewed changes into a commit"
              : (git?.ahead ?? 0) > 0
                ? "Commit is ready to publish"
                : "Completion path";

  const lifecycle: HandoffLifecycleProjection = {
    lifecycleVersion: lifecycleBase.lifecycleVersion,
    lane: lifecycleBase.lane,
    laneLabel: lifecycleBase.laneLabel,
    tone: lifecycleBase.tone,
    processStatus: lifecycleBase.processStatus,
    processLabel: lifecycleBase.processLabel,
    jobStatus: lifecycleBase.jobStatus,
    taskLabel: lifecycleBase.jobLabel,
    reviewReady,
    reviewLabel: layers.reviewLabel,
    validationLabel: layers.validationLabel,
    validationNeedsAttention,
    handoffLabel,
    layers,
    reason: lifecycleBase.reason,
    reasonSource: lifecycleBase.reasonSource,
    isDiagnostic,
  };

  return {
    steps,
    nextAction,
    headline,
    issueCount,
    dirtyCount,
    stagedCount,
    branch: git?.branch ?? null,
    workspaceLabel: session.config.isolationGuard ? "Isolated worktree" : "Workspace",
    outcome: session.handoffOutcome ?? null,
    lifecycle,
  };
}
