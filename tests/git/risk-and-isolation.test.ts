import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  gitRiskProfile,
  isGitAction,
  isGitReadAction,
} from "../../src/lib/git/risk";
import {
  assertNotMainCheckout,
  registerManagedWorktree,
  unregisterManagedWorktree,
  findManagedWorktree,
  listManagedWorktrees,
} from "../../src/lib/git/worktree-registry";
import { executeGitAction } from "../../src/lib/git/operations";
import { parsePorcelainStatus } from "../../src/lib/git/porcelain";
import { collectGitStatus } from "../../src/lib/git/status";
import {
  clearTrustedRoots,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";

function git(cwd: string, args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

describe("git risk profiles", () => {
  it("classifies read vs write vs destructive", () => {
    assert.equal(isGitReadAction("status"), true);
    assert.equal(isGitReadAction("commit"), false);
    assert.equal(gitRiskProfile("discard").risk, "destructive");
    assert.equal(gitRiskProfile("discard").requiresConfirm, true);
    assert.equal(gitRiskProfile("stage").requiresConfirm, false);
    assert.equal(gitRiskProfile("push").risk, "network");
    assert.equal(gitRiskProfile("worktree_add").allowedInPlan, false);
    assert.equal(isGitAction("stage"), true);
    assert.equal(isGitAction("rm -rf"), false);
  });
});

describe("worktree isolation", () => {
  let root: string;
  let prevHome: string | undefined;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "spok-wt-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = path.join(root, "spok-home");
    mkdirSync(process.env.SPOK_HOME, { recursive: true });
  });

  after(() => {
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("blocks writes when cwd equals main checkout under isolation", () => {
    const main = path.join(root, "main");
    const r = assertNotMainCheckout({ cwd: main, mainCheckout: main });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /main checkout/i);
  });

  it("allows writes when cwd is a different worktree path", () => {
    const main = path.join(root, "main");
    const wt = path.join(root, "wt-feature");
    const r = assertNotMainCheckout({ cwd: wt, mainCheckout: main });
    assert.equal(r.ok, true);
  });

  it("registers and finds managed worktrees", () => {
    const main = path.join(root, "repo-main");
    const wt = path.join(root, "repo-wt");
    registerManagedWorktree({
      path: wt,
      mainCheckout: main,
      branch: "spok/test",
    });
    const found = findManagedWorktree(wt);
    assert.ok(found);
    assert.equal(found!.branch, "spok/test");
    assert.ok(listManagedWorktrees().some((w) => w.path.includes("repo-wt")));
    assert.equal(unregisterManagedWorktree(wt), true);
    assert.equal(findManagedWorktree(wt), undefined);
  });
});

describe("git operations (temp repo)", () => {
  let repo: string;
  let prevHome: string | undefined;

  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), "spok-git-ops-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = path.join(repo, ".spok-home");
    mkdirSync(process.env.SPOK_HOME, { recursive: true });

    git(repo, ["init"]);
    git(repo, ["config", "user.email", "spok@test.local"]);
    git(repo, ["config", "user.name", "Spok Test"]);
    writeFileSync(path.join(repo, "README.md"), "# test\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "init"]);

    clearTrustedRoots();
    trustWorkspaceRoot(repo);
  });

  after(() => {
    clearTrustedRoots();
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    rmSync(repo, { recursive: true, force: true });
  });

  it("collects status and stages/commits with confirmation", async () => {
    writeFileSync(path.join(repo, "feature.ts"), "export const x = 1;\n");
    writeFileSync(path.join(repo, "README.md"), "# test\n\nupdated\n");

    const st = await collectGitStatus(repo);
    assert.equal(st.error, undefined);
    assert.ok(st.files.length >= 2);
    assert.equal(st.clean, false);

    const porcelain = parsePorcelainStatus(
      st.files.map((f) => `${f.code} ${f.path}`).join("\n")
    );
    assert.ok(porcelain.length >= 1);

    // commit without confirm → needsConfirm
    const need = await executeGitAction({
      action: "commit",
      cwd: repo,
      message: "should fail",
    });
    assert.equal(need.needsConfirm, true);
    assert.equal(need.ok, false);

    await executeGitAction({ action: "stage", cwd: repo, paths: ["feature.ts"] });
    const afterStage = await collectGitStatus(repo);
    assert.ok(afterStage.stagedCount >= 1);

    // Path traversal rejected
    const trav = await executeGitAction({
      action: "stage",
      cwd: repo,
      paths: ["../outside.ts"],
    });
    assert.equal(trav.ok, false);

    const committed = await executeGitAction({
      action: "commit",
      cwd: repo,
      message: "add feature",
      confirm: true,
    });
    assert.equal(committed.ok, true);
    assert.ok(committed.commit?.oid);

    // After commit of feature.ts, remaining dirty is README
    const mid = await collectGitStatus(repo);
    assert.ok(mid.files.some((f) => f.path === "README.md"));

    // Isolation: refuse discard on main when isolationGuard + mainCheckout
    writeFileSync(path.join(repo, "scratch.txt"), "tmp\n");
    const blocked = await executeGitAction({
      action: "discard",
      cwd: repo,
      paths: ["scratch.txt"],
      confirm: true,
      isolationGuard: true,
      mainCheckout: repo,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "isolation_guard");

    // Without isolation, discard untracked works
    const discarded = await executeGitAction({
      action: "discard",
      cwd: repo,
      paths: ["scratch.txt"],
      confirm: true,
    });
    assert.equal(discarded.ok, true);
  });

  it("refuses discard without paths", async () => {
    const r = await executeGitAction({
      action: "discard",
      cwd: repo,
      paths: [],
      confirm: true,
    });
    assert.equal(r.ok, false);
  });

  it("creates worktree as sibling and returns absolute path", async () => {
    const wtPath = path.join(path.dirname(repo), `spok-wt-test-${Date.now()}`);
    const r = await executeGitAction({
      action: "worktree_add",
      cwd: repo,
      worktreePath: wtPath,
      branch: "spok/review-test",
      confirm: true,
    });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.createdWorktree?.path);
    assert.equal(r.createdWorktree?.branch, "spok/review-test");

    // Nested worktree path rejected
    const nested = await executeGitAction({
      action: "worktree_add",
      cwd: repo,
      worktreePath: path.join(repo, "nested-wt"),
      confirm: true,
    });
    assert.equal(nested.ok, false);

    // Cleanup
    const rem = await executeGitAction({
      action: "worktree_remove",
      cwd: repo,
      worktreePath: r.createdWorktree!.path,
      confirm: true,
    });
    assert.equal(rem.ok, true, rem.error);
  });
});
