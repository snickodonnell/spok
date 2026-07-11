import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearTrustedRoots,
  findTrustedRoot,
  getWorkspaceTrustFilePath,
  isTrustedWorkspacePath,
  listTrustedRootEntries,
  listTrustedRoots,
  reloadTrustedRootsFromDisk,
  revokeTrustedRoot,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";
import { canonicalizePath } from "../../src/lib/security/paths";

describe("durable workspace trust", () => {
  let home: string;
  let prevHome: string | undefined;
  let workspaceA: string;
  let workspaceB: string;

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), "spok-trust-home-"));
    workspaceA = mkdtempSync(path.join(tmpdir(), "spok-ws-a-"));
    workspaceB = mkdtempSync(path.join(tmpdir(), "spok-ws-b-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = home;
    mkdirSync(home, { recursive: true });
    clearTrustedRoots();
  });

  after(() => {
    clearTrustedRoots();
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    for (const p of [home, workspaceA, workspaceB]) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  beforeEach(() => {
    clearTrustedRoots();
  });

  it("persists trust to workspace-trust.json and reloads after clear memory", () => {
    const root = trustWorkspaceRoot(workspaceA);
    assert.equal(root, canonicalizePath(workspaceA));
    assert.equal(isTrustedWorkspacePath(workspaceA), true);
    assert.equal(
      isTrustedWorkspacePath(path.join(workspaceA, "src", "x.ts")),
      true
    );

    const file = getWorkspaceTrustFilePath();
    assert.ok(existsSync(file));
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
      roots: { path: string; trustedAt: number }[];
    };
    assert.equal(raw.version, 1);
    assert.equal(raw.roots.length, 1);
    assert.equal(raw.roots[0].path, root);
    assert.ok(raw.roots[0].trustedAt > 0);

    // Simulate process restart: drop memory, reload from disk
    clearTrustedRoots();
    // clearTrustedRoots also empties disk — re-seed disk only
    writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          roots: [{ path: root, trustedAt: 1_700_000_000_000 }],
        },
        null,
        2
      ),
      "utf8"
    );
    reloadTrustedRootsFromDisk();
    assert.deepEqual(listTrustedRoots(), [root]);
    assert.equal(findTrustedRoot(path.join(workspaceA, "pkg")), root);
    assert.equal(listTrustedRootEntries()[0].trustedAt, 1_700_000_000_000);
  });

  it("revokes trust and denies nested paths afterward", () => {
    trustWorkspaceRoot(workspaceA);
    trustWorkspaceRoot(workspaceB);
    assert.equal(listTrustedRoots().length, 2);

    const revoked = revokeTrustedRoot(workspaceA);
    assert.equal(revoked, true);
    assert.equal(isTrustedWorkspacePath(workspaceA), false);
    assert.equal(isTrustedWorkspacePath(workspaceB), true);
    assert.equal(revokeTrustedRoot(workspaceA), false);

    const file = JSON.parse(
      readFileSync(getWorkspaceTrustFilePath(), "utf8")
    ) as { roots: { path: string }[] };
    assert.equal(file.roots.length, 1);
    assert.equal(file.roots[0].path, canonicalizePath(workspaceB));
  });

  it("keeps original trustedAt on re-trust", () => {
    const root = trustWorkspaceRoot(workspaceA);
    const first = listTrustedRootEntries().find((e) => e.path === root)!;
    trustWorkspaceRoot(workspaceA);
    const second = listTrustedRootEntries().find((e) => e.path === root)!;
    assert.equal(first.trustedAt, second.trustedAt);
  });

  it("ignores corrupt trust files without throwing", () => {
    const file = getWorkspaceTrustFilePath();
    writeFileSync(file, "{not-json", "utf8");
    reloadTrustedRootsFromDisk();
    assert.deepEqual(listTrustedRoots(), []);
    // Recover by trusting
    trustWorkspaceRoot(workspaceA);
    assert.equal(listTrustedRoots().length, 1);
  });
});
