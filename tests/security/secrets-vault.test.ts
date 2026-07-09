import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  writeSecret,
  readSecret,
  deleteSecret,
  listSecretIds,
  vaultDiagnostics,
} from "../../src/lib/security/secrets-vault";

describe("secrets vault", () => {
  let home: string;
  let prevHome: string | undefined;

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), "spok-vault-"));
    prevHome = process.env.SPOK_HOME;
    process.env.SPOK_HOME = home;
  });

  after(() => {
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("round-trips encrypted secrets", () => {
    const w = writeSecret("gh_token", "ghp_test_secret_value_123");
    assert.equal(w.id, "gh_token");
    assert.ok(w.bytes > 0);

    const value = readSecret("gh_token");
    assert.equal(value, "ghp_test_secret_value_123");

    const ids = listSecretIds();
    assert.ok(ids.includes("gh_token"));

    const diag = vaultDiagnostics();
    assert.equal(diag.secretCount, 1);
    assert.equal(diag.hasKey, true);
    assert.ok(diag.path.includes("secrets"));

    assert.equal(deleteSecret("gh_token"), true);
    assert.equal(readSecret("gh_token"), null);
  });

  it("rejects empty secret ids", () => {
    assert.throws(() => writeSecret("", "x"));
  });
});
