import type { GitAction, GitOpRisk } from "./types";

export type GitRiskProfile = {
  risk: GitOpRisk;
  /** Plan / read-only mode may run this. */
  allowedInPlan: boolean;
  /** Requires explicit confirm: true from the client. */
  requiresConfirm: boolean;
  /** Human label for dialogs. */
  label: string;
  description: string;
};

const PROFILES: Record<GitAction, GitRiskProfile> = {
  status: {
    risk: "read",
    allowedInPlan: true,
    requiresConfirm: false,
    label: "Status",
    description: "Read working tree status",
  },
  branch_list: {
    risk: "read",
    allowedInPlan: true,
    requiresConfirm: false,
    label: "List branches",
    description: "List local branches",
  },
  worktree_list: {
    risk: "read",
    allowedInPlan: true,
    requiresConfirm: false,
    label: "List worktrees",
    description: "List linked worktrees",
  },
  log: {
    risk: "read",
    allowedInPlan: true,
    requiresConfirm: false,
    label: "Log",
    description: "Read recent commits",
  },
  stage: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: false,
    label: "Stage",
    description: "Stage files into the index",
  },
  unstage: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: false,
    label: "Unstage",
    description: "Remove files from the index",
  },
  stage_hunk: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: false,
    label: "Stage hunk",
    description: "Stage a selected diff hunk",
  },
  unstage_hunk: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: false,
    label: "Unstage hunk",
    description: "Unstage a selected diff hunk",
  },
  commit: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Commit",
    description: "Create a commit from the staged index",
  },
  branch_create: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: false,
    label: "Create branch",
    description: "Create a new local branch",
  },
  checkout: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Checkout",
    description: "Switch branch or restore paths (can move HEAD)",
  },
  discard: {
    risk: "destructive",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Discard changes",
    description: "Permanently discard unstaged or untracked changes",
  },
  discard_hunk: {
    risk: "destructive",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Discard hunk",
    description: "Permanently discard a selected hunk from the working tree",
  },
  push: {
    risk: "network",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Push",
    description: "Push commits to a remote",
  },
  pull: {
    risk: "network",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Pull",
    description: "Fetch and integrate remote changes",
  },
  worktree_add: {
    risk: "write",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Create worktree",
    description: "Create an isolated linked worktree for parallel work",
  },
  worktree_remove: {
    risk: "destructive",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Remove worktree",
    description: "Remove a linked worktree directory",
  },
  pr_create: {
    risk: "network",
    allowedInPlan: false,
    requiresConfirm: true,
    label: "Create pull request",
    description: "Open a PR via the GitHub CLI",
  },
};

export function gitRiskProfile(action: GitAction): GitRiskProfile {
  return PROFILES[action];
}

export function isGitReadAction(action: GitAction): boolean {
  return PROFILES[action].risk === "read";
}

export function isGitAction(value: unknown): value is GitAction {
  return typeof value === "string" && value in PROFILES;
}
