import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitStatusSnapshot } from "../../src/lib/git/types";
import {
  IsolationSetupError,
  buildManagedWorktreePlan,
  establishIsolatedWorkspace,
} from "../../src/lib/automation/worktree-isolation";

function status(opts: {
  repoRoot: string;
  isWorktree?: boolean;
  mainWorktreePath?: string | null;
  branch?: string;
}): GitStatusSnapshot {
  return {
    cwd: opts.repoRoot,
    repoRoot: opts.repoRoot,
    isWorktree: opts.isWorktree ?? false,
    mainWorktreePath: opts.mainWorktreePath ?? null,
    branch: {
      current: opts.branch ?? "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      detached: false,
      headOid: "abc1234",
      isDetached: false,
    },
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    clean: true,
    skipped: [],
    timestamp: 1,
  };
}

describe("background worktree isolation", () => {
  it("builds deterministic sibling paths and Spok branch names", () => {
    assert.deepEqual(buildManagedWorktreePlan("C:\\dev\\spok", "job-AbC_12"), {
      worktreePath: "C:\\dev\\spok-spok-abc_12",
      branch: "spok/abc_12",
    });
    assert.deepEqual(buildManagedWorktreePlan("/work/repo", "job-xyz"), {
      worktreePath: "/work/repo-spok-xyz",
      branch: "spok/xyz",
    });
  });

  it("creates, persists, and verifies an isolated workspace", async () => {
    const main = "C:\\dev\\repo";
    const plan = buildManagedWorktreePlan(main, "job-safe");
    const policyCwds: string[] = [];
    const statusCwds: string[] = [];
    const persisted: Array<{
      worktreePath: string;
      branch: string;
      mainCheckout: string;
    }> = [];

    const result = await establishIsolatedWorkspace(
      { jobId: "job-safe", cwd: main },
      {
        checkPolicy: async (opts) => {
          policyCwds.push(opts.cwd);
          return { ok: true, reason: "trusted" };
        },
        getStatus: async (cwd) => {
          statusCwds.push(cwd);
          return cwd === main
            ? status({ repoRoot: main })
            : status({
                repoRoot: plan.worktreePath,
                isWorktree: true,
                mainWorktreePath: main,
                branch: plan.branch,
              });
        },
        createWorktree: async (opts) => ({
          ok: true,
          createdWorktree: {
            path: opts.worktreePath,
            branch: opts.branch,
          },
        }),
        onCreated: (workspace) => persisted.push(workspace),
      }
    );

    assert.equal(result.worktreePath, plan.worktreePath);
    assert.equal(result.branch, plan.branch);
    assert.equal(result.mainCheckout, main);
    assert.equal(result.status.isWorktree, true);
    assert.deepEqual(statusCwds, [main, plan.worktreePath]);
    assert.deepEqual(policyCwds, [main, main, plan.worktreePath]);
    assert.deepEqual(persisted, [
      {
        worktreePath: plan.worktreePath,
        branch: plan.branch,
        mainCheckout: main,
      },
    ]);
  });

  it("fails closed when the privileged worktree action fails", async () => {
    const main = "/work/repo";
    const statusCwds: string[] = [];

    await assert.rejects(
      establishIsolatedWorkspace(
        { jobId: "job-denied", cwd: main },
        {
          checkPolicy: async () => ({ ok: true, reason: "trusted" }),
          getStatus: async (cwd) => {
            statusCwds.push(cwd);
            return status({ repoRoot: main });
          },
          createWorktree: async () => ({
            ok: false,
            error: "Plan mode blocks worktree creation",
            code: "command_not_allowed",
          }),
        }
      ),
      (error: unknown) => {
        assert.ok(error instanceof IsolationSetupError);
        assert.equal(error.code, "command_not_allowed");
        assert.match(error.message, /plan mode/i);
        return true;
      }
    );

    // The source checkout is inspected once; it is never returned as a run cwd.
    assert.deepEqual(statusCwds, [main]);
  });

  it("rejects a linked-worktree source and a mismatched verification", async () => {
    const main = "/work/repo";
    await assert.rejects(
      establishIsolatedWorkspace(
        { jobId: "job-nested", cwd: "/work/existing" },
        {
          checkPolicy: async () => ({ ok: true, reason: "trusted" }),
          getStatus: async () =>
            status({
              repoRoot: "/work/existing",
              isWorktree: true,
              mainWorktreePath: main,
            }),
          createWorktree: async () => {
            throw new Error("must not create");
          },
        }
      ),
      (error: unknown) =>
        error instanceof IsolationSetupError && error.code === "source_is_worktree"
    );

    const plan = buildManagedWorktreePlan(main, "job-mismatch");
    let persisted = false;
    await assert.rejects(
      establishIsolatedWorkspace(
        { jobId: "job-mismatch", cwd: main },
        {
          checkPolicy: async () => ({ ok: true, reason: "trusted" }),
          getStatus: async (cwd) =>
            cwd === main
              ? status({ repoRoot: main })
              : status({
                  repoRoot: plan.worktreePath,
                  isWorktree: true,
                  mainWorktreePath: "/work/other",
                }),
          createWorktree: async () => ({
            ok: true,
            createdWorktree: {
              path: plan.worktreePath,
              branch: plan.branch,
            },
          }),
          onCreated: () => {
            persisted = true;
          },
        }
      ),
      (error: unknown) =>
        error instanceof IsolationSetupError &&
        error.code === "main_checkout_mismatch"
    );
    assert.equal(persisted, true);
  });
});
