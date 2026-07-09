import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  buildDiagnosticsBundle,
  summarizeDiagnostics,
} from "../../src/lib/diagnostics";

describe("diagnostics bundle", () => {
  let home: string;
  let prevHome: string | undefined;

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), "spok-diag-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = home;
  });

  after(() => {
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("builds a redacted bundle with checks", () => {
    const bundle = buildDiagnosticsBundle();
    assert.equal(bundle.version, 1);
    assert.ok(bundle.generatedAt);
    assert.equal(bundle.app.name, "spok");
    assert.ok(bundle.paths.spokHome.includes(home) || bundle.paths.spokHome === home);
    assert.ok(Array.isArray(bundle.checks));
    assert.ok(bundle.checks.length >= 3);
    // Never embed capability token value
    const json = JSON.stringify(bundle);
    assert.equal(json.includes("localToken"), false);
    assert.ok(typeof bundle.security.capabilityTokenPresent === "boolean");

    const summary = summarizeDiagnostics(bundle);
    assert.ok(summary.headline);
    assert.ok(summary.ok + summary.warn + summary.error >= 1);
  });
});
