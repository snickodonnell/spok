/**
 * Pre-commit / PR readiness checklist for the Review workbench.
 * Pure functions — unit-tested, reused by Changes and Review UI.
 */

import type { Session } from "./types";

export type ChecklistSeverity = "ok" | "warn" | "block" | "info";

export interface ChecklistItem {
  id: string;
  label: string;
  detail: string;
  severity: ChecklistSeverity;
  /** When true, commit should be discouraged or blocked in UI. */
  blocksCommit?: boolean;
}

export interface ReviewReadiness {
  items: ChecklistItem[];
  readyToCommit: boolean;
  readyToPush: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  unresolvedComments: number;
  secretFiles: number;
  conflictCount: number;
  summary: string;
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

/**
 * Build a commit/PR readiness checklist from session state.
 */
export function buildReviewReadiness(session: Session): ReviewReadiness {
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

  const items: ChecklistItem[] = [];

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

  if (isLive) {
    items.push({
      id: "run",
      label: "Agent run",
      detail: "A run is still active — prefer waiting for completion",
      severity: "warn",
    });
  } else if (session.status === "error") {
    items.push({
      id: "run",
      label: "Agent run",
      detail: "Last run ended in error",
      severity: "warn",
    });
  } else {
    items.push({
      id: "run",
      label: "Agent run",
      detail:
        session.status === "completed" || session.status === "ready"
          ? "Idle"
          : session.status,
      severity: "ok",
    });
  }

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

  const readyToCommit = !items.some((i) => i.blocksCommit);
  const readyToPush =
    readyToCommit &&
    (session.gitSummary?.ahead ?? 0) >= 0 &&
    !isLive;

  let summary: string;
  if (!readyToCommit) {
    const blockers = items.filter((i) => i.blocksCommit).map((i) => i.label);
    summary = `Not ready: ${blockers.join(", ")}`;
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
  };
}
