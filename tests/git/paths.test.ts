import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  assertWorktreeLocationAllowed,
  isValidGitRefName,
  resolveRepoPaths,
  resolveWorktreeAbsPath,
} from "../../src/lib/git/paths";
import { assertWorktreeIsolation } from "../../src/lib/git/worktree-registry";

describe("git path helpers", () => {
  const root = path.resolve("/tmp/spok-repo-root");

  it("resolves relative paths under cwd", () => {
    const paths = resolveRepoPaths(root, ["src/a.ts", "./lib/b.ts"]);
    assert.deepEqual(paths, ["src/a.ts", "lib/b.ts"]);
  });

  it("rejects path traversal", () => {
    assert.throws(() => resolveRepoPaths(root, ["../outside"]), /Invalid path|outside/i);
    assert.throws(
      () => resolveRepoPaths(root, [path.join(root, "..", "evil")]),
      /outside/i
    );
  });

  it("rejects prefix-confusion absolute paths", () => {
    // C:\repo vs C:\repo-evil style — only exact root or under it
    const winRoot = "C:\\dev\\spok";
    if (process.platform === "win32") {
      assert.throws(
        () => resolveRepoPaths(winRoot, ["C:\\dev\\spok-evil\\x.ts"]),
        /outside/i
      );
    } else {
      assert.throws(
        () => resolveRepoPaths("/tmp/spok", ["/tmp/spok-evil/x.ts"]),
        /outside/i
      );
    }
  });

  it("validates ref names", () => {
    assert.equal(isValidGitRefName("feature/auth"), true);
    assert.equal(isValidGitRefName("spok/2026-01-01-abc"), true);
    assert.equal(isValidGitRefName("-bad"), false);
    assert.equal(isValidGitRefName("HEAD"), false);
    assert.equal(isValidGitRefName("a..b"), false);
    assert.equal(isValidGitRefName("a b"), false);
  });

  it("resolves worktree paths relative to cwd", () => {
    const abs = resolveWorktreeAbsPath(root, "neighbor-wt");
    assert.ok(abs.includes("neighbor-wt"));
    assert.ok(path.isAbsolute(abs));
  });

  it("allows sibling worktrees, rejects nested", () => {
    const repo = path.resolve("/data/project");
    const sibling = path.resolve("/data/project-wt");
    const nested = path.resolve("/data/project/wt");
    assert.doesNotThrow(() =>
      assertWorktreeLocationAllowed({
        absWorktreePath: sibling,
        repoRoot: repo,
        trustedRoots: [],
      })
    );
    assert.throws(
      () =>
        assertWorktreeLocationAllowed({
          absWorktreePath: nested,
          repoRoot: repo,
          trustedRoots: [],
        }),
      /inside the main working tree/i
    );
    assert.throws(
      () =>
        assertWorktreeLocationAllowed({
          absWorktreePath: repo,
          repoRoot: repo,
          trustedRoots: [],
        }),
      /main repository/i
    );
  });

  it("isolation blocks main checkout writes", () => {
    const main = path.resolve("/repos/app");
    const wt = path.resolve("/repos/app-wt");
    const blocked = assertWorktreeIsolation({
      cwd: main,
      mainCheckout: main,
      isolationGuard: true,
    });
    assert.equal(blocked.ok, false);

    const allowed = assertWorktreeIsolation({
      cwd: wt,
      mainCheckout: main,
      isolationGuard: true,
    });
    assert.equal(allowed.ok, true);

    const off = assertWorktreeIsolation({
      cwd: main,
      mainCheckout: main,
      isolationGuard: false,
    });
    assert.equal(off.ok, true);
  });
});
