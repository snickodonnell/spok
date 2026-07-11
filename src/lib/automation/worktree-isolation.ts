import type { GitStatusSnapshot } from "../git/types";

type PolicyDecision = { ok: boolean; reason: string; code?: string };

type WorktreeCreateResult = {
  ok: boolean;
  createdWorktree?: { path: string; branch: string };
  error?: string;
  code?: string;
};

export type IsolatedWorkspace = {
  worktreePath: string;
  branch: string;
  mainCheckout: string;
  status: GitStatusSnapshot;
};

export type IsolationSetupDependencies = {
  checkPolicy: (opts: {
    cwd: string;
    requireTrusted: true;
    isolate: boolean;
    mainCheckout?: string;
  }) => Promise<PolicyDecision>;
  getStatus: (cwd: string) => Promise<GitStatusSnapshot | null>;
  createWorktree: (opts: {
    cwd: string;
    worktreePath: string;
    branch: string;
  }) => Promise<WorktreeCreateResult>;
  /** Persist the privileged result before the verification request. */
  onCreated?: (
    workspace: Omit<IsolatedWorkspace, "status">
  ) => unknown | Promise<unknown>;
};

export class IsolationSetupError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "IsolationSetupError";
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function safeSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

/** Build a deterministic sibling path and a safe Spok-owned branch name. */
export function buildManagedWorktreePlan(
  mainCheckout: string,
  jobId: string
): { worktreePath: string; branch: string } {
  const checkout = mainCheckout.replace(/[\\/]+$/, "");
  const slash = Math.max(checkout.lastIndexOf("/"), checkout.lastIndexOf("\\"));
  if (slash < 0) {
    throw new IsolationSetupError(
      "Cannot derive a sibling worktree path from the main checkout",
      "invalid_main_checkout"
    );
  }

  const separator = checkout[slash] === "\\" ? "\\" : "/";
  const parent = checkout.slice(0, slash) || separator;
  const repo = safeSlug(checkout.slice(slash + 1), "repo");
  const job = safeSlug(jobId.replace(/^job-/i, ""), "job");
  return {
    worktreePath: `${parent}${parent.endsWith(separator) ? "" : separator}${repo}-spok-${job}`,
    branch: `spok/${job}`,
  };
}

async function requirePolicy(
  deps: IsolationSetupDependencies,
  cwd: string,
  isolate: boolean,
  mainCheckout?: string
): Promise<void> {
  const decision = await deps.checkPolicy({
    cwd,
    requireTrusted: true,
    isolate,
    mainCheckout,
  });
  if (!decision.ok) {
    throw new IsolationSetupError(
      decision.reason || "Automation policy denied the workspace",
      decision.code || "policy_denied"
    );
  }
}

function requireStatus(
  status: GitStatusSnapshot | null,
  label: string
): GitStatusSnapshot {
  if (!status || status.error || !status.repoRoot) {
    throw new IsolationSetupError(
      status?.error || `${label} is not an accessible Git checkout`,
      "git_status_failed"
    );
  }
  return status;
}

function verifyLinkedWorktree(
  status: GitStatusSnapshot,
  worktreePath: string,
  mainCheckout: string
): void {
  if (!status.isWorktree) {
    throw new IsolationSetupError(
      "Isolation verification failed: the prepared path is not a linked worktree",
      "not_linked_worktree"
    );
  }
  if (!pathsEqual(status.repoRoot, worktreePath)) {
    throw new IsolationSetupError(
      "Isolation verification failed: Git resolved a different worktree path",
      "worktree_path_mismatch"
    );
  }
  if (!status.mainWorktreePath || !pathsEqual(status.mainWorktreePath, mainCheckout)) {
    throw new IsolationSetupError(
      "Isolation verification failed: linked worktree belongs to a different main checkout",
      "main_checkout_mismatch"
    );
  }
}

/**
 * Establish or re-verify the isolated execution cwd for a queued job.
 * This function never returns the input cwd as a fallback.
 */
export async function establishIsolatedWorkspace(
  input: {
    jobId: string;
    cwd: string;
    worktreePath?: string;
    branch?: string;
    mainCheckout?: string;
  },
  deps: IsolationSetupDependencies
): Promise<IsolatedWorkspace> {
  if (input.worktreePath) {
    if (!input.mainCheckout) {
      throw new IsolationSetupError(
        "An existing isolated job is missing its main checkout link",
        "missing_main_checkout"
      );
    }
    await requirePolicy(deps, input.mainCheckout, false);
    const status = requireStatus(
      await deps.getStatus(input.worktreePath),
      "Existing worktree"
    );
    verifyLinkedWorktree(status, input.worktreePath, input.mainCheckout);
    await requirePolicy(deps, input.worktreePath, true, input.mainCheckout);
    return {
      worktreePath: input.worktreePath,
      branch: input.branch || status.branch.current || "unknown",
      mainCheckout: input.mainCheckout,
      status,
    };
  }

  // Trust is checked before Git discovery and again on the canonical repo root.
  await requirePolicy(deps, input.cwd, false);
  const source = requireStatus(await deps.getStatus(input.cwd), "Source checkout");
  if (source.isWorktree) {
    throw new IsolationSetupError(
      "Isolated background jobs must start from the trusted main checkout",
      "source_is_worktree"
    );
  }

  const mainCheckout = source.repoRoot;
  if (input.mainCheckout && !pathsEqual(input.mainCheckout, mainCheckout)) {
    throw new IsolationSetupError(
      "Queued job main checkout does not match the Git repository root",
      "main_checkout_mismatch"
    );
  }
  await requirePolicy(deps, mainCheckout, false);

  const plan = buildManagedWorktreePlan(mainCheckout, input.jobId);
  const created = await deps.createWorktree({
    cwd: mainCheckout,
    worktreePath: plan.worktreePath,
    branch: plan.branch,
  });
  if (!created.ok || !created.createdWorktree) {
    throw new IsolationSetupError(
      created.error || "Spok could not create the isolated worktree",
      created.code || "worktree_create_failed"
    );
  }

  const linked = {
    worktreePath: created.createdWorktree.path,
    branch: created.createdWorktree.branch,
    mainCheckout,
  };
  await deps.onCreated?.(linked);

  const status = requireStatus(
    await deps.getStatus(linked.worktreePath),
    "Created worktree"
  );
  verifyLinkedWorktree(status, linked.worktreePath, mainCheckout);
  await requirePolicy(deps, linked.worktreePath, true, mainCheckout);

  return { ...linked, status };
}
