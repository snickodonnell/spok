/**
 * Phase 3: accurate Git status, worktree, and review models.
 */

export type GitFileState =
  | "untracked"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "unmerged"
  | "ignored"
  | "unchanged";

/** Where a change lives relative to the index. */
export type GitChangeArea = "staged" | "unstaged" | "untracked" | "conflict";

export type GitOpRisk = "read" | "write" | "destructive" | "network";

/**
 * Allowed mutation / query actions for the Spok git bridge.
 * Keep this list closed — the API must not accept arbitrary git argv.
 */
export type GitAction =
  | "status"
  | "stage"
  | "unstage"
  | "discard"
  | "stage_hunk"
  | "unstage_hunk"
  | "discard_hunk"
  | "commit"
  | "branch_list"
  | "branch_create"
  | "checkout"
  | "push"
  | "pull"
  | "worktree_list"
  | "worktree_add"
  | "worktree_remove"
  | "pr_create"
  | "log";

export interface GitFileEntry {
  path: string;
  oldPath?: string;
  /** Index (staged) XY left char meaning, human-readable. */
  indexStatus: GitFileState;
  /** Worktree XY right char meaning. */
  worktreeStatus: GitFileState;
  /** Areas this path appears in (may be both staged + unstaged). */
  areas: GitChangeArea[];
  isBinary?: boolean;
  isSecret?: boolean;
  modeChange?: boolean;
  /** Original porcelain XY code for debugging. */
  code: string;
  additions?: number;
  deletions?: number;
}

export interface GitBranchInfo {
  current: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  /** Short oid when detached or for display. */
  headOid: string | null;
  /** true when not on a branch (detached HEAD). */
  isDetached: boolean;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  head: string | null;
  /** True when this path is the primary linked checkout Spok opened. */
  isMain?: boolean;
  /** True when Spok created/registered this worktree for isolation. */
  managedBySpok?: boolean;
}

export interface GitStatusSnapshot {
  cwd: string;
  /** Canonical main worktree root (from git rev-parse --show-toplevel). */
  repoRoot: string;
  /** True when cwd is a linked worktree, not the main checkout. */
  isWorktree: boolean;
  /** Main worktree absolute path when in a linked worktree. */
  mainWorktreePath: string | null;
  branch: GitBranchInfo;
  files: GitFileEntry[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  clean: boolean;
  /** Skipped/denied paths (secrets, binary preview limits). */
  skipped: Array<{ path: string; reason: string }>;
  timestamp: number;
  error?: string;
}

export interface ReviewComment {
  id: string;
  /** Session this comment belongs to. */
  sessionId: string;
  path: string;
  /** 1-based line in the new file, if any. */
  line?: number;
  /** Optional hunk id from FileDiff. */
  hunkId?: string;
  /** Linked trace node (why this change). */
  traceNodeId?: string;
  body: string;
  author: "user" | "agent" | "system";
  createdAt: number;
  resolved?: boolean;
}

export interface GitCommitResult {
  ok: boolean;
  oid?: string;
  message?: string;
  summary?: string;
  error?: string;
}

export interface GitPushResult {
  ok: boolean;
  remote?: string;
  branch?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface GitPrResult {
  ok: boolean;
  url?: string;
  number?: number;
  stdout?: string;
  error?: string;
  /** When gh is not installed. */
  unavailable?: boolean;
}

export type GitActionRequest = {
  action: GitAction;
  cwd: string;
  sessionId?: string;
  /** Paths relative to repo root (or absolute under cwd). */
  paths?: string[];
  /** Commit / PR title-body. */
  message?: string;
  body?: string;
  /** Branch names. */
  branch?: string;
  startPoint?: string;
  /** worktree_add path; worktree_remove path. */
  worktreePath?: string;
  /** For handoff: whether to trust the new worktree root. */
  trustWorktree?: boolean;
  /** Hunk patch text for stage/unstage/discard hunk. */
  patch?: string;
  /** Push remote (default origin). */
  remote?: string;
  /** Force push — always requires confirm. */
  force?: boolean;
  /** Amend last commit. */
  amend?: boolean;
  /** Create branch and checkout. */
  createBranch?: boolean;
  /**
   * Client must send true for destructive / network ops after UI confirmation.
   * Server rejects without it.
   */
  confirm?: boolean;
  /** Isolation: when true, refuse ops that would touch main checkout from a managed worktree session. */
  isolationGuard?: boolean;
  /** Expected main checkout path for isolation checks. */
  mainCheckout?: string;
};

export type GitActionResponse = {
  ok: boolean;
  action: GitAction;
  status?: GitStatusSnapshot;
  branches?: string[];
  worktrees?: GitWorktreeInfo[];
  commit?: GitCommitResult;
  push?: GitPushResult;
  pr?: GitPrResult;
  log?: Array<{ oid: string; subject: string; author: string; date: string }>;
  /** Absolute path + branch after worktree_add */
  createdWorktree?: { path: string; branch: string };
  stdout?: string;
  stderr?: string;
  error?: string;
  code?: string;
  auditId?: string;
  /** True when confirmation is required but was not provided. */
  needsConfirm?: boolean;
  risk?: GitOpRisk;
};
