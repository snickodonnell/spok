import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSettings } from "../../src/lib/settings/defaults";
import { mergeLayeredSettings, sanitizePartialSettings } from "../../src/lib/settings/merge";
import {
  evaluatePolicy,
  actionFingerprint,
} from "../../src/lib/security/permission-policy";
import {
  resolveCommandProfile,
  matchCommandPattern,
} from "../../src/lib/security/command-profiles";
import {
  clearTrustedRoots,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";

describe("command profiles", () => {
  it("resolves grok, git, npm, and custom", () => {
    assert.equal(resolveCommandProfile("grok").id, "grok");
    assert.equal(resolveCommandProfile("C:\\\\tools\\\\grok.exe").id, "grok");
    assert.equal(resolveCommandProfile("git").id, "git");
    assert.equal(resolveCommandProfile("npm.cmd").id, "package");
    assert.equal(resolveCommandProfile("evil.exe").id, "custom");
  });

  it("matches brace and wildcard command patterns", () => {
    assert.equal(matchCommandPattern("cmd.exe", "{cmd,cmd.exe,powershell}"), true);
    assert.equal(matchCommandPattern("bash", "{cmd,cmd.exe}"), false);
    assert.equal(matchCommandPattern("node", "node*"), true);
  });
});

describe("layered settings merge", () => {
  it("lets later layers override scalars and merge rules by id", () => {
    const bundle = mergeLayeredSettings({
      managed: { permissionMode: "plan" },
      user: {
        permissionMode: "manual",
        rules: [
          {
            id: "user-deny",
            effect: "deny",
            actions: ["spawn"],
            command: "evil",
            enabled: true,
          },
        ],
      },
      project: { allowCustomCommands: true },
      local: { permissionMode: "auto" },
    });
    assert.equal(bundle.resolved.permissionMode, "auto");
    assert.equal(bundle.provenance.permissionMode, "local");
    assert.equal(bundle.resolved.allowCustomCommands, true);
    assert.ok(bundle.resolved.rules.some((r) => r.id === "user-deny"));
    assert.ok(bundle.resolved.rules.some((r) => r.id === "deny-shell-interpreters"));
  });

  it("sanitizes untrusted input", () => {
    const p = sanitizePartialSettings({
      permissionMode: "nope",
      allowCustomCommands: "yes",
      rules: [{ id: "x", effect: "deny", actions: ["spawn"] }],
    });
    assert.equal(p.permissionMode, undefined);
    assert.equal(p.allowCustomCommands, undefined);
    assert.equal(p.rules?.[0].id, "x");
  });
});

describe("permission policy engine", () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "spok-policy-"));
    clearTrustedRoots();
    trustWorkspaceRoot(root);
  });

  after(() => {
    clearTrustedRoots();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("allows grok spawn in manual mode inside trusted cwd", () => {
    const settings = defaultSettings();
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "grok",
      args: ["-p", "hello"],
      cwd: root,
    });
    assert.equal(d.decision, "allow");
    assert.equal(d.profile, "grok");
  });

  it("denies shell interpreters via default rule", () => {
    const settings = defaultSettings();
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "powershell.exe",
      args: ["-Command", "dir"],
      cwd: root,
    });
    assert.equal(d.decision, "deny");
    assert.match(d.policy, /rule:/);
  });

  it("asks for custom commands when not allowlisted", () => {
    const settings = { ...defaultSettings(), allowCustomCommands: false };
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "my-custom-agent",
      args: [],
      cwd: root,
    });
    assert.equal(d.decision, "ask");
    assert.equal(d.requiresApproval, true);
    assert.equal(d.profile, "custom");
  });

  it("denies spawn in plan mode", () => {
    const settings = { ...defaultSettings(), permissionMode: "plan" as const };
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "grok",
      args: [],
      cwd: root,
    });
    assert.equal(d.decision, "deny");
    assert.equal(d.policy, "mode:plan");
  });

  it("auto mode allows only autoProfiles", () => {
    const settings = {
      ...defaultSettings(),
      permissionMode: "auto" as const,
      autoProfiles: ["grok"],
    };
    const grok = evaluatePolicy({
      settings,
      action: "spawn",
      command: "grok",
      cwd: root,
    });
    assert.equal(grok.decision, "allow");

    const npm = evaluatePolicy({
      settings,
      action: "spawn",
      command: "npm",
      args: ["test"],
      cwd: root,
    });
    assert.equal(npm.decision, "ask");
  });

  it("bypass allows custom but still denies shell rules", () => {
    const settings = {
      ...defaultSettings(),
      permissionMode: "bypass" as const,
    };
    const custom = evaluatePolicy({
      settings,
      action: "spawn",
      command: "my-bin",
      cwd: root,
    });
    assert.equal(custom.decision, "allow");

    const shell = evaluatePolicy({
      settings,
      action: "spawn",
      command: "cmd.exe",
      cwd: root,
    });
    assert.equal(shell.decision, "deny");
  });

  it("honors allow_always grants for same command+cwd (any args)", () => {
    const settings = { ...defaultSettings(), allowCustomCommands: false };
    const ctx = {
      settings,
      action: "spawn" as const,
      command: "my-tool",
      args: ["run"],
      cwd: root,
    };
    const fp = actionFingerprint(ctx, { includeArgs: false });
    const d = evaluatePolicy({
      ...ctx,
      grants: [
        {
          id: "g1",
          fingerprint: fp,
          decision: "allow_always",
          createdAt: Date.now(),
          command: "my-tool",
          cwd: root,
          action: "spawn",
        },
      ],
    });
    assert.equal(d.decision, "allow");
    assert.match(d.policy, /grant:/);

    // Different args still allowed for allow_always
    const d2 = evaluatePolicy({
      ...ctx,
      args: ["other", "flags"],
      grants: [
        {
          id: "g1",
          fingerprint: fp,
          decision: "allow_always",
          createdAt: Date.now(),
          command: "my-tool",
          cwd: root,
          action: "spawn",
        },
      ],
    });
    assert.equal(d2.decision, "allow");
  });

  it("does not treat profile-only grants as blanket approve", () => {
    const settings = { ...defaultSettings(), allowCustomCommands: false };
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "other-custom-bin",
      cwd: root,
      grants: [
        {
          id: "g1",
          fingerprint: "unrelated",
          decision: "allow_always",
          createdAt: Date.now(),
          command: "first-tool",
          profile: "custom",
          cwd: root,
          action: "spawn",
        },
      ],
    });
    assert.equal(d.decision, "ask");
  });

  it("honors explicit allow rules even for high-risk profiles", () => {
    const settings = {
      ...defaultSettings(),
      rules: [
        ...defaultSettings().rules,
        {
          id: "allow-npm",
          effect: "allow" as const,
          actions: ["spawn" as const],
          profile: "package",
          enabled: true,
        },
      ],
    };
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "npm",
      args: ["test"],
      cwd: root,
    });
    assert.equal(d.decision, "allow");
    assert.match(d.policy, /rule:allow-npm/);
  });

  it("allows git inspection in plan mode", () => {
    const settings = { ...defaultSettings(), permissionMode: "plan" as const };
    const d = evaluatePolicy({
      settings,
      action: "git",
      command: "git",
      cwd: root,
    });
    assert.equal(d.decision, "allow");
  });

  it("denies untrusted cwd for spawn", () => {
    const settings = defaultSettings();
    const outside =
      process.platform === "win32"
        ? "D:\\spok-untrusted-outside"
        : "/var/spok-untrusted-outside";
    const d = evaluatePolicy({
      settings,
      action: "spawn",
      command: "grok",
      cwd: outside,
    });
    assert.equal(d.decision, "deny");
    assert.equal(d.policy, "workspace_trust");
  });
});
