import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createGrokPromptArtifact,
  finalizeGrokPromptArtifact,
  getGrokPromptArtifactsRoot,
  recoverGrokPromptArtifacts,
  verifyGrokPromptArtifact,
} from "../../src/lib/runtime/grok-prompt-artifacts";

let root = "";
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-prompts-"));
  process.env.SPOK_HOME = root;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

describe("managed Grok prompt artifacts", { concurrency: false }, () => {
  it("writes a long prompt once, returns only pinned metadata, and cleans success", () => {
    const secret = "Bearer sk-not-a-real-secret-value";
    const content = `${"mission context\n".repeat(2_000)}${secret}`;
    const artifact = createGrokPromptArtifact({
      sessionId: "session-001",
      runSpecId: "run-001",
      content,
      format: "text",
    });
    assert.ok(existsSync(artifact.path));
    assert.equal(artifact.bytes, Buffer.byteLength(content));
    assert.equal(artifact.sha256.length, 64);
    assert.ok(!JSON.stringify(artifact).includes(secret));

    const retry = createGrokPromptArtifact({
      sessionId: "session-001",
      runSpecId: "run-001",
      content,
      format: "text",
    });
    assert.deepEqual(retry, artifact);
    assert.equal(verifyGrokPromptArtifact(artifact).id, artifact.id);

    const finalized = finalizeGrokPromptArtifact(artifact, "completed");
    assert.deepEqual(finalized, { removed: true, retained: false });
    assert.equal(existsSync(artifact.path), false);
  });

  it("detects content tampering and retains failed evidence", () => {
    const artifact = createGrokPromptArtifact({
      sessionId: "session-002",
      runSpecId: "run-002",
      content: "bounded prompt",
      format: "text",
      ephemeral: false,
    });
    assert.deepEqual(finalizeGrokPromptArtifact(artifact, "failed"), {
      removed: false,
      retained: true,
    });
    writeFileSync(artifact.path, "tampered", "utf8");
    assert.throws(() => verifyGrokPromptArtifact(artifact), /size|hash/i);
  });

  it("recovers stale crash or approval-abandonment directories but preserves active runs", () => {
    const stale = createGrokPromptArtifact({
      sessionId: "session-003",
      runSpecId: "run-stale",
      content: "stale prompt",
      format: "text",
      now: 1,
    });
    const active = createGrokPromptArtifact({
      sessionId: "session-003",
      runSpecId: "run-active",
      content: "active prompt",
      format: "text",
      now: 1,
    });
    const orphan = path.join(getGrokPromptArtifactsRoot(), "session-003", "orphan-run");
    mkdirSync(orphan, { recursive: true });
    writeFileSync(path.join(orphan, "prompt.txt"), "orphan", "utf8");

    const recovered = recoverGrokPromptArtifacts({
      now: Date.now() + 100_000,
      maxAgeMs: 0,
      activeRunSpecIds: ["run-active"],
    });
    assert.ok(recovered.removed.includes(stale.id));
    assert.ok(recovered.retained.includes(active.id));
    assert.equal(existsSync(stale.path), false);
    assert.equal(existsSync(active.path), true);
    assert.equal(existsSync(orphan), false);
  });
});
