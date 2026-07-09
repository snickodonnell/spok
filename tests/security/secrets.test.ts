import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideFilePreview,
  isDeniedSecretPath,
  isLikelyBinary,
  matchDenyGlob,
  redactSecrets,
} from "../../src/lib/security/secrets";
import {
  canonicalizePath,
  isPathInsideRoot,
} from "../../src/lib/security/paths";
import {
  clearTrustedRoots,
  isTrustedWorkspacePath,
  requireTrustedCwd,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";
import {
  isCommandAllowed,
  isLocalHostAllowed,
  isOriginAllowed,
} from "../../src/lib/security/local-api";

describe("secret redaction", () => {
  it("redacts bearer tokens and aws keys", () => {
    const input =
      "Authorization: Bearer sk_live_abcdefghijklmnopqrstuv and key AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(input);
    assert.equal(result.redacted, true);
    assert.ok(result.count >= 1);
    assert.ok(!result.text.includes("sk_live_abcdefghijklmnopqrstuv"));
    assert.ok(!result.text.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(result.text.includes("[REDACTED]"));
  });

  it("redacts private key blocks", () => {
    const pem = `before
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC
-----END PRIVATE KEY-----
after`;
    const result = redactSecrets(pem);
    assert.equal(result.redacted, true);
    assert.ok(result.categories.includes("private_key"));
    assert.ok(!result.text.includes("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC"));
  });
});

describe("secret path deny list", () => {
  it("denies .env and credential-like paths", () => {
    assert.equal(isDeniedSecretPath(".env"), true);
    assert.equal(isDeniedSecretPath(".env.local"), true);
    assert.equal(isDeniedSecretPath("config/credentials.json"), true);
    assert.equal(isDeniedSecretPath("keys/server.pem"), true);
    assert.equal(isDeniedSecretPath("src/app.ts"), false);
  });

  it("matches nested deny globs", () => {
    assert.equal(matchDenyGlob("foo/.env", "**/.env"), true);
    assert.equal(matchDenyGlob("src/lib/store.ts", "**/.env"), false);
  });
});

describe("file preview policy", () => {
  it("denies secret paths before reading content", () => {
    const d = decideFilePreview({
      relativePath: ".env",
      sizeBytes: 12,
      maxBytes: 512 * 1024,
      contentSample: "SECRET=1",
    });
    assert.equal(d.action, "deny");
  });

  it("skips large and binary files", () => {
    const large = decideFilePreview({
      relativePath: "big.bin",
      sizeBytes: 1024 * 1024,
      maxBytes: 512 * 1024,
    });
    assert.equal(large.action, "skip");

    const binary = decideFilePreview({
      relativePath: "photo.png",
      sizeBytes: 100,
      maxBytes: 512 * 1024,
      contentSample: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4, 5]),
    });
    assert.equal(binary.action, "skip");
    assert.equal(isLikelyBinary(Buffer.from([0, 1, 2, 3])), true);
  });
});

describe("workspace trust containment", () => {
  it("trusts roots and rejects outside cwd", () => {
    clearTrustedRoots();
    const root = canonicalizePath(process.cwd());
    trustWorkspaceRoot(root);
    assert.equal(isTrustedWorkspacePath(root), true);
    assert.equal(isPathInsideRoot(root, root), true);

    const ok = requireTrustedCwd(root);
    assert.equal(ok.ok, true);

    const outside = requireTrustedCwd(
      process.platform === "win32" ? "C:\\Windows\\System32" : "/tmp/not-trusted-spok"
    );
    // On machines where cwd is under System32 this could theoretically pass — force a sibling
    if (outside.ok) {
      clearTrustedRoots();
      trustWorkspaceRoot(root);
      const denied = requireTrustedCwd(
        process.platform === "win32" ? "D:\\definitely-untrusted-spok" : "/var/empty-spok-untrusted"
      );
      // If D: doesn't exist canonicalize still works for path policy
      assert.equal(denied.ok, false);
    } else {
      assert.equal(outside.ok, false);
    }
  });
});

describe("local host/origin policy", () => {
  it("allows localhost Host and Origin", () => {
    assert.equal(isLocalHostAllowed("localhost:3000"), true);
    assert.equal(isLocalHostAllowed("127.0.0.1:3000"), true);
    assert.equal(isLocalHostAllowed("evil.example:3000"), false);
    assert.equal(isOriginAllowed("http://localhost:3000", "localhost:3000"), true);
    assert.equal(isOriginAllowed("https://evil.example", "localhost:3000"), false);
  });

  it("restricts commands to grok by default", () => {
    const prev = process.env.SPOK_ALLOW_CUSTOM_COMMANDS;
    delete process.env.SPOK_ALLOW_CUSTOM_COMMANDS;
    assert.equal(isCommandAllowed("grok"), true);
    assert.equal(isCommandAllowed("cmd.exe"), false);
    if (prev !== undefined) process.env.SPOK_ALLOW_CUSTOM_COMMANDS = prev;
  });
});
