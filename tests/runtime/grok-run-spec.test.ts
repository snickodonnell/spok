import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  GROK_CAPABILITY_IDS,
  type GrokCapabilitySnapshot,
} from "../../src/lib/runtime/grok-capabilities";
import {
  compileGrokRunSpec,
  GrokRunSpecError,
  hashGrokRunContent,
  parseGrokRunSpec,
  type GrokRunSpec,
} from "../../src/lib/runtime/grok-run-spec";

const cwd = path.resolve("test-fixtures", "isolated-worktree");
const promptPath = path.resolve("test-fixtures", "prompts", "leaf.md");
const promptHash = hashGrokRunContent("bounded leaf prompt");
const fingerprint = hashGrokRunContent("capability-snapshot");
const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";

function snapshot(
  overrides: Partial<GrokCapabilitySnapshot> = {}
): GrokCapabilitySnapshot {
  return {
    schemaVersion: 1,
    fingerprint,
    capturedAt: 1,
    command: "grok",
    cwd,
    probeMs: 5,
    binary: {
      found: true,
      version: "0.2.99",
      commit: "b1b49ccb71",
      channel: "stable",
    },
    inspect: {
      status: "available",
      grokVersion: "0.2.99",
      channel: "stable",
      projectTrusted: true,
      bridgeTrusted: true,
      projectRootPresent: true,
      apiKeyAuthDisabled: false,
      permissionSourceCount: 1,
      skillCount: 0,
      agentCount: 0,
      pluginCount: 0,
      mcpServerCount: 0,
    },
    auth: {
      checked: false,
      state: "unknown",
      reason: "inspect_does_not_report_auth_state",
    },
    supportedFlags: [],
    supportedCommands: [],
    capabilities: Object.fromEntries(
      GROK_CAPABILITY_IDS.map((id) => [id, "supported"])
    ) as GrokCapabilitySnapshot["capabilities"],
    leader: { status: "available", activeCount: 0 },
    errors: [],
    ...overrides,
  };
}

function baseSpec(): GrokRunSpec {
  return {
    version: 1,
    id: "leaf-001",
    command: "grok",
    capabilitySnapshot: { version: 1, fingerprint },
    cwd,
    unattended: true,
    role: "leaf",
    workspace: {
      kind: "existing",
      path: cwd,
      isolation: "verified",
      branch: "codex/leaf-001",
      baseRevision: "abc123",
    },
    prompt: {
      transport: "file",
      path: promptPath,
      sha256: promptHash,
      bytes: Buffer.byteLength("bounded leaf prompt"),
      ephemeral: true,
    },
    session: { intent: "new", sessionId: sessionA },
    execution: {
      model: "grok-code-fast-1",
      agent: "build",
      reasoningEffort: "medium",
      maxTurns: 8,
      tools: { allow: ["read", "edit"], deny: ["web"] },
      webSearch: "disabled",
      alwaysApprove: false,
      permissionMode: "default",
      sandbox: "workspace-write",
      noMemory: true,
      noPlan: true,
      check: false,
      delegation: { mode: "deny" },
    },
    output: { mode: "stream", format: "streaming-json" },
    debug: { retention: "none" },
  };
}

describe("GrokRunSpec argv compiler", () => {
  it("compiles a bounded isolated leaf into deterministic argv", () => {
    const compiled = compileGrokRunSpec(baseSpec(), snapshot());
    assert.deepEqual(compiled.args, [
      "--model",
      "grok-code-fast-1",
      "--agent",
      "build",
      "--reasoning-effort",
      "medium",
      "--max-turns",
      "8",
      "--tools",
      "read,edit",
      "--disallowed-tools",
      "web",
      "--disable-web-search",
      "--permission-mode",
      "default",
      "--sandbox",
      "workspace-write",
      "--no-subagents",
      "--no-memory",
      "--no-plan",
      "--session-id",
      sessionA,
      "--output-format",
      "streaming-json",
      "--prompt-file",
      promptPath,
    ]);
    assert.equal(compiled.receipt.prompt.sha256, promptHash);
    assert.equal(compiled.receipt.argvHash.length, 64);
    assert.ok(compiled.receipt.requiredCapabilities.includes("no_subagents"));
    assert.ok(Object.isFrozen(compiled));
    assert.ok(Object.isFrozen(compiled.spec.execution.tools));
  });

  for (const testCase of [
    {
      name: "resumes an exact session",
      session: { intent: "resume", sessionId: sessionA } as const,
      expected: ["--resume", sessionA],
    },
    {
      name: "forks from an exact session into an exact new identity",
      session: {
        intent: "fork",
        sourceSessionId: sessionA,
        newSessionId: sessionB,
      } as const,
      expected: ["--resume", sessionA, "--fork-session", "--session-id", sessionB],
    },
  ]) {
    it(testCase.name, () => {
      const spec = { ...baseSpec(), session: testCase.session };
      const args = compileGrokRunSpec(spec, snapshot()).args;
      const start = args.findIndex((value) => value === testCase.expected[0]);
      assert.deepEqual(args.slice(start, start + testCase.expected.length), testCase.expected);
    });
  }

  it("keeps report output mutually exclusive with streaming output and redacts its schema", () => {
    const schema = JSON.stringify({ type: "object", required: ["outcome"] });
    const spec: GrokRunSpec = {
      ...baseSpec(),
      output: {
        mode: "report",
        format: "json",
        schema,
        schemaHash: hashGrokRunContent(schema),
        schemaBytes: Buffer.byteLength(schema),
      },
    };
    const compiled = compileGrokRunSpec(spec, snapshot());
    assert.ok(compiled.args.includes(schema));
    assert.ok(!compiled.args.includes("streaming-json"));
    assert.ok(!JSON.stringify(compiled.receipt).includes(schema));
    assert.match(JSON.stringify(compiled.receipt.argvPreview), /json-schema sha256=/);
  });

  it("redacts attended inline prompt contents while fingerprinting real argv", () => {
    const value = "inspect this tiny diff without exposing the prompt";
    const spec: GrokRunSpec = {
      ...baseSpec(),
      id: "interactive-001",
      role: "interactive",
      unattended: false,
      workspace: { kind: "existing", path: cwd, isolation: "not_required" },
      prompt: {
        transport: "inline",
        value,
        sha256: hashGrokRunContent(value),
        bytes: Buffer.byteLength(value),
      },
      execution: { ...baseSpec().execution, delegation: { mode: "deny" } },
    };
    const compiled = compileGrokRunSpec(spec, snapshot());
    assert.ok(compiled.args.includes(value));
    assert.ok(!JSON.stringify(compiled.receipt).includes(value));
    assert.match(JSON.stringify(compiled.receipt.argvPreview), /inline-prompt sha256=/);
  });

  it("rejects leaf launch without verified isolation", () => {
    const spec = {
      ...baseSpec(),
      workspace: { kind: "existing", path: cwd, isolation: "not_required" },
    };
    assertRunSpecError(() => parseGrokRunSpec(spec), "verified isolated worktree");
  });

  it("rejects descendants from a leaf receipt", () => {
    const spec = {
      ...baseSpec(),
      execution: {
        ...baseSpec().execution,
        delegation: { mode: "allow", budgetRef: "child-budget" },
      },
    };
    assertRunSpecError(() => parseGrokRunSpec(spec), "leaf runs must deny subagents");
  });

  it("rejects ambiguous latest-session continuation for unattended work", () => {
    const spec = { ...baseSpec(), session: { intent: "continue_latest" } };
    assertRunSpecError(() => parseGrokRunSpec(spec), "continue-latest");
  });

  it("fails closed when a required capability is unsupported", () => {
    const capabilities = { ...snapshot().capabilities, prompt_file: "unsupported" as const };
    assertRunSpecError(
      () => compileGrokRunSpec(baseSpec(), snapshot({ capabilities })),
      "cannot satisfy"
    );
  });

  it("rejects a stale or foreign capability fingerprint", () => {
    assertRunSpecError(
      () => compileGrokRunSpec(baseSpec(), snapshot({ fingerprint: "f".repeat(64) })),
      "does not match"
    );
  });
});

function assertRunSpecError(fn: () => unknown, pattern: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof GrokRunSpecError);
    assert.match(
      `${error.message} ${error.issues.map((issue) => issue.message).join(" ")}`,
      new RegExp(pattern, "i")
    );
    assert.ok(error.correctiveAction.length > 0);
    return true;
  });
}
