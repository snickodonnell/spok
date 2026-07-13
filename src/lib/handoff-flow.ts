/**
 * Pure completion-flow derivation for the Review workbench.
 *
 * This intentionally describes existing, policy-gated Git actions. Durable
 * handoff evidence is historical context only; fresh Git/session state always
 * reconstructs the next action and the record never grants authority.
 */

import { buildReviewQueue } from "./review-queue";
import type { HandoffOutcomeRecord, Session } from "./types";

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
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function buildHandoffFlow(session: Session): HandoffFlow {
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

  let nextAction: HandoffAction;
  if (isLive) {
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

  const reviewStatus: HandoffStepStatus = isLive
    ? "blocked"
    : issueCount > 0 || conflictCount > 0
      ? "active"
      : hasHandoffWork || prReady
        ? "complete"
        : "pending";
  const commitStatus: HandoffStepStatus =
    dirtyCount === 0 && ((git?.ahead ?? 0) > 0 || prReady)
      ? "complete"
      : reviewStatus === "complete" && dirtyCount > 0
        ? "active"
        : reviewStatus === "active" || reviewStatus === "blocked"
          ? "blocked"
          : "pending";
  const pushStatus: HandoffStepStatus = prReady
    ? "complete"
    : commitComplete
      ? "active"
      : commitStatus === "blocked"
        ? "blocked"
        : "pending";
  const prStatus: HandoffStepStatus = prReady ? "active" : "pending";

  const steps: HandoffStep[] = [
    {
      id: "review",
      label: "Review",
      detail: isLive
        ? "Run in progress"
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

  const headline = isLive
    ? "Handoff waits for the active run"
    : issueCount > 0
      ? `${plural(issueCount, "finding")} need attention`
      : prReady
        ? "Branch is ready for a pull request"
        : dirtyCount > 0
          ? "Move reviewed changes into a commit"
          : (git?.ahead ?? 0) > 0
            ? "Commit is ready to publish"
            : "Completion path";

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
  };
}
