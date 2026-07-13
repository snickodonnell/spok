import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearTrustedRoots,
  getWorkspaceTrustFilePath,
  isTrustedWorkspacePath,
  listTrustedRoots,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";
import { evaluateAutomationCwdPolicy } from "../../src/lib/automation/policy";
import { canonicalizePath } from "../../src/lib/security/paths";

/**
 * Cross-process trust coherence: a long-lived process (e.g. residual Next
 * policy-check route) must see roots another process already persisted to
 * workspace-trust.json without a restart — and still deny untrusted siblings.
 */
describe("workspace trust cross-process coherence", () => {
  let home: string;
  let prevHome: string | undefined;
  let mainCheckout: string;
  let siblingTrusted: string;
  let siblingUntrusted: string;

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), "spok-trust-cohere-home-"));
    mainCheckout = mkdtempSync(path.join(tmpdir(), "spok-cohere-main-"));
    siblingTrusted = mkdtempSync(path.join(tmpdir(), "spok-cohere-wt-ok-"));
    siblingUntrusted = mkdtempSync(path.join(tmpdir(), "spok-cohere-wt-no-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = home;
    mkdirSync(home, { recursive: true });
    clearTrustedRoots();
  });

  after(() => {
    clearTrustedRoots();
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    for (const p of [
      home,
      mainCheckout,
      siblingTrusted,
      siblingUntrusted,
    ]) {
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

  it("policy check sees sibling worktree trusted by another process without restart", () => {
    // Long-lived process loads trust for the main checkout (stale snapshot risk).
    const mainRoot = trustWorkspaceRoot(mainCheckout);
    assert.equal(isTrustedWorkspacePath(mainCheckout), true);
    assert.deepEqual(listTrustedRoots(), [mainRoot]);

    const policyBefore = evaluateAutomationCwdPolicy({
      cwd: siblingTrusted,
      requireTrusted: true,
    });
    assert.equal(policyBefore.ok, false);
    assert.equal(
      policyBefore.ok === false && policyBefore.code,
      "untrusted_cwd"
    );

    // Other process (standalone runtime) persists a newly trusted worktree path.
    // Write durable file directly — do not call trustWorkspaceRoot in this process.
    const siblingRoot = canonicalizePath(siblingTrusted);
    const trustedAt = 1_720_000_000_000;
    writeFileSync(
      getWorkspaceTrustFilePath(),
      JSON.stringify(
        {
          version: 1,
          roots: [
            { path: mainRoot, trustedAt: 1_700_000_000_000 },
            { path: siblingRoot, trustedAt },
          ],
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    // Same process, no restart: automation policy-check must refresh and allow.
    const policyAfter = evaluateAutomationCwdPolicy({
      cwd: siblingTrusted,
      requireTrusted: true,
    });
    assert.equal(policyAfter.ok, true);
    assert.equal(isTrustedWorkspacePath(siblingTrusted), true);
    assert.ok(listTrustedRoots().includes(siblingRoot));
    assert.ok(listTrustedRoots().includes(mainRoot));

    // Untrusted sibling remains denied (no wildcard / skip requireTrusted).
    const deniedSibling = evaluateAutomationCwdPolicy({
      cwd: siblingUntrusted,
      requireTrusted: true,
    });
    assert.equal(deniedSibling.ok, false);
    assert.equal(
      deniedSibling.ok === false && deniedSibling.code,
      "untrusted_cwd"
    );
    assert.equal(isTrustedWorkspacePath(siblingUntrusted), false);
  });

  it("refresh picks up external revoke (fail-safe) without granting new roots", () => {
    const root = trustWorkspaceRoot(mainCheckout);
    assert.equal(
      evaluateAutomationCwdPolicy({ cwd: root, requireTrusted: true }).ok,
      true
    );

    // External process revokes all trust by writing empty durable state.
    writeFileSync(
      getWorkspaceTrustFilePath(),
      JSON.stringify({ version: 1, roots: [] }, null, 2) + "\n",
      "utf8"
    );

    const afterRevoke = evaluateAutomationCwdPolicy({
      cwd: root,
      requireTrusted: true,
    });
    assert.equal(afterRevoke.ok, false);
    assert.equal(
      afterRevoke.ok === false && afterRevoke.code,
      "untrusted_cwd"
    );
    assert.deepEqual(listTrustedRoots(), []);
  });
});
