import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearApprovalGrants,
  consumeOnceToken,
  createApprovalRequest,
  decideApproval,
  getActiveGrants,
  listApprovalGrants,
} from "../../src/lib/security/approvals";

describe("approval grants and once tokens", () => {
  let dir: string;
  const prevHome = process.env.SPOK_HOME;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "spok-approvals-"));
    process.env.SPOK_HOME = dir;
    clearApprovalGrants();
  });

  after(() => {
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("issues onceToken for allow_once and allow_always", () => {
    const req = createApprovalRequest({
      action: "spawn",
      command: "my-bin",
      args: ["a"],
      cwd: "C:\\repo",
      risk: "critical",
      reason: "test",
      policy: "custom_command_gate",
      preview: "preview",
      profile: "custom",
    });
    const once = decideApproval(req.id, "allow_once");
    assert.equal(once.ok, true);
    assert.ok(once.onceToken);

    const req2 = createApprovalRequest({
      action: "spawn",
      command: "my-bin",
      args: ["b"],
      cwd: "C:\\repo",
      risk: "critical",
      reason: "test",
      policy: "custom_command_gate",
      preview: "preview",
      profile: "custom",
    });
    const always = decideApproval(req2.id, "allow_always");
    assert.equal(always.ok, true);
    assert.ok(always.onceToken);
    assert.ok(listApprovalGrants().some((g) => g.decision === "allow_always"));
  });

  it("consumes token only for matching command fingerprint", () => {
    const req = createApprovalRequest({
      action: "spawn",
      command: "tool-a",
      args: ["1"],
      cwd: "/tmp/r",
      risk: "high",
      reason: "t",
      policy: "x",
      preview: "p",
    });
    const { onceToken } = decideApproval(req.id, "allow_once");
    assert.ok(onceToken);

    // Wrong command — must not consume
    const wrong = consumeOnceToken(onceToken, {
      action: "spawn",
      command: "tool-b",
      args: ["1"],
      cwd: "/tmp/r",
    });
    assert.equal(wrong, null);

    // Correct command — consume
    const ok = consumeOnceToken(onceToken, {
      action: "spawn",
      command: "tool-a",
      args: ["1"],
      cwd: "/tmp/r",
    });
    assert.ok(ok);

    // Second consume fails
    const again = consumeOnceToken(onceToken, {
      action: "spawn",
      command: "tool-a",
      args: ["1"],
      cwd: "/tmp/r",
    });
    assert.equal(again, null);
  });

  it("keeps privileged argv out of approval display without weakening the token", () => {
    const secretPrompt = "private prompt body";
    const req = createApprovalRequest(
      {
        action: "spawn",
        command: "grok",
        args: ["--prompt", "<inline-prompt sha256=abc>"],
        cwd: "/tmp/r",
        risk: "high",
        reason: "t",
        policy: "x",
        preview: "redacted preview",
      },
      { fingerprintArgs: ["--prompt", secretPrompt] }
    );
    assert.ok(!JSON.stringify(req).includes(secretPrompt));

    const { onceToken } = decideApproval(req.id, "allow_once");
    assert.ok(onceToken);
    assert.equal(
      consumeOnceToken(onceToken, {
        action: "spawn",
        command: "grok",
        args: ["--prompt", "different prompt"],
        cwd: "/tmp/r",
      }),
      null
    );
    assert.ok(
      consumeOnceToken(onceToken, {
        action: "spawn",
        command: "grok",
        args: ["--prompt", secretPrompt],
        cwd: "/tmp/r",
      })
    );
  });

  it("persists allow_always across getActiveGrants", () => {
    clearApprovalGrants();
    const req = createApprovalRequest({
      action: "spawn",
      command: "persist-me",
      args: [],
      cwd: "/ws",
      risk: "medium",
      reason: "t",
      policy: "x",
      preview: "p",
    });
    decideApproval(req.id, "allow_always");
    const grants = getActiveGrants();
    assert.ok(grants.some((g) => g.command === "persist-me"));
  });
});
