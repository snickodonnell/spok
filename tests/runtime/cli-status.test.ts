import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectAuthFailureHint,
  CLI_AUTH_GUIDANCE,
} from "../../src/lib/runtime/auth-hints";
import {
  captureCliCommand,
  probeCliStatus,
} from "../../src/lib/runtime/cli-status";

describe("auth failure heuristics", () => {
  it("detects common auth phrases", () => {
    assert.ok(detectAuthFailureHint("Error: not authenticated"));
    assert.ok(detectAuthFailureHint("Please log in to continue"));
    assert.ok(detectAuthFailureHint("Unauthorized: invalid API token"));
    assert.equal(detectAuthFailureHint("All tests passed"), null);
    assert.equal(detectAuthFailureHint(""), null);
  });

  it("returns external-CLI guidance (never Spok login)", () => {
    const hint = detectAuthFailureHint("authentication required");
    assert.equal(hint, CLI_AUTH_GUIDANCE);
    assert.match(hint!, /native Grok CLI/i);
    assert.doesNotMatch(hint!, /sign in to Spok/i);
  });
});

describe("cli probe", () => {
  it("reports not_found for a nonsense binary", async () => {
    const status = await probeCliStatus(
      "spok-definitely-not-a-real-binary-xyz-987"
    );
    assert.equal(status.found, false);
    assert.equal(status.authChecked, false);
    assert.ok(status.authGuidance.includes("native Grok CLI"));
  });

  it("finds node binary when available", async () => {
    const status = await probeCliStatus("node");
    // node is required to run these tests
    assert.equal(status.found, true);
    // version may or may not parse from --version
    assert.equal(status.authChecked, false);
  });

  it("bounds provider-controlled probe output", async () => {
    const capture = await captureCliCommand(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(4096))"],
      { maxOutputBytes: 64 }
    );
    assert.equal(capture.error, "probe_output_limit");
    assert.ok(Buffer.byteLength(capture.stdout) <= 64);
  });
});
