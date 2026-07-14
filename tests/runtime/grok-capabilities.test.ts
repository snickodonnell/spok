import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkGrokCompatibility,
  inferGrokCapabilitiesFromArgs,
  probeGrokCapabilities,
  type GrokCapabilityProbeRunner,
} from "../../src/lib/runtime/grok-capabilities";
import type { CliCaptureResult } from "../../src/lib/runtime/cli-status";

const GROK_0_2_99_HELP = `
Grok Build TUI

Options:
      --prompt-file <PATH>
      --prompt-json <JSON>
      --output-format <OUTPUT_FORMAT>  [possible values: text, json, streaming-json]
      --json-schema <SCHEMA>
      --max-turns <N>
      --reasoning-effort <EFFORT>
      --tools <TOOLS>
      --disallowed-tools <TOOLS>
      --disable-web-search
      --permission-mode <MODE>
      --sandbox <PROFILE>
      --no-subagents
      --no-memory
      --check
  -r, --resume [<SESSION_ID>]
  -s, --session-id <SESSION_ID>
      --fork-session
      --leader-socket <PATH>
  -w, --worktree [<WORKTREE>]
      --worktree-ref <WORKTREE_REF>
      --debug-file <FILE>

Commands:
  inspect     Show discovered configuration
  leader      Manage leader processes
  sessions    List sessions
  trace       Export trace evidence
  export      Export a transcript
  worktree    Manage git worktrees
`;

const INSPECT_WITH_SENSITIVE_PATHS = JSON.stringify({
  grokVersion: "0.2.99",
  channel: "stable",
  cwd: "C:\\secret\\customer-repo",
  projectRoot: "C:\\secret\\customer-repo",
  projectTrusted: true,
  bridgeTrusted: true,
  projectInstructions: [
    { path: "C:\\secret\\customer-repo\\AGENTS.md", sizeBytes: 100 },
  ],
  permissions: { sources: [{ path: "C:\\Users\\private\\config.toml" }] },
  loginPolicy: {
    forceLoginTeamUuid: "private-team-uuid",
    apiKeyAuthDisabled: false,
  },
  skills: [{ name: "one" }],
  agents: [{ name: "one" }, { name: "two" }],
  plugins: [],
  mcpServers: [],
});

function result(
  stdout: string,
  overrides: Partial<CliCaptureResult> = {}
): CliCaptureResult {
  return { code: 0, stdout, stderr: "", ...overrides };
}

function fixtureRunner(
  overrides: Partial<Record<string, CliCaptureResult>> = {}
): GrokCapabilityProbeRunner {
  const fixtures: Record<string, CliCaptureResult> = {
    "--version": result("grok 0.2.99 (b1b49ccb71) [stable]"),
    "--help": result(GROK_0_2_99_HELP),
    "inspect --json": result(INSPECT_WITH_SENSITIVE_PATHS),
    "leader list --json": result("[]"),
    ...overrides,
  };
  return async (args) =>
    fixtures[args.join(" ")] ?? {
      code: 2,
      stdout: "",
      stderr: "unsupported fixture command",
    };
}

describe("versioned Grok capability snapshot", () => {
  it("discovers the supported 0.2.99 contract and keeps raw inspect paths out of state", async () => {
    const snapshot = await probeGrokCapabilities({
      command: "grok",
      cwd: "C:\\trusted\\repo",
      includeLeaderHealth: true,
      now: () => 1_700_000_000_000,
      runner: fixtureRunner(),
    });

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.binary.found, true);
    assert.equal(snapshot.binary.version, "0.2.99");
    assert.equal(snapshot.binary.commit, "b1b49ccb71");
    assert.equal(snapshot.binary.channel, "stable");
    assert.equal(snapshot.inspect.status, "available");
    assert.equal(snapshot.inspect.projectRootPresent, true);
    assert.equal(snapshot.inspect.skillCount, 1);
    assert.equal(snapshot.inspect.agentCount, 2);
    assert.equal(snapshot.auth.checked, false);
    assert.equal(snapshot.auth.state, "unknown");
    assert.equal(snapshot.leader.status, "available");
    assert.equal(snapshot.leader.activeCount, 0);
    assert.equal(snapshot.capabilities.prompt_file, "supported");
    assert.equal(snapshot.capabilities.streaming_json, "supported");
    assert.equal(snapshot.capabilities.no_subagents, "supported");
    assert.equal(snapshot.capabilities.structured_report, "supported");
    assert.equal(snapshot.capabilities.leader_health_json, "supported");
    assert.match(snapshot.fingerprint, /^[0-9a-f]{64}$/);
    assert.match(snapshot.inspect.contentHash || "", /^[0-9a-f]{64}$/);

    const recaptured = await probeGrokCapabilities({
      command: "grok",
      cwd: "C:\\trusted\\repo",
      includeLeaderHealth: true,
      now: () => 1_800_000_000_000,
      runner: fixtureRunner(),
    });
    assert.equal(recaptured.fingerprint, snapshot.fingerprint);

    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /customer-repo|private-team-uuid|private\\config/i);

    const compatibility = checkGrokCompatibility(snapshot, [
      "prompt_file",
      "streaming_json",
      "no_subagents",
      "exact_session",
    ]);
    assert.equal(compatibility.ok, true);
    assert.equal(compatibility.correctiveAction, null);
    assert.equal(compatibility.snapshotFingerprint, snapshot.fingerprint);
  });

  it("blocks a required capability that the discovered CLI does not support", async () => {
    const oldHelp = GROK_0_2_99_HELP.replace("      --prompt-file <PATH>\n", "");
    const snapshot = await probeGrokCapabilities({
      runner: fixtureRunner({ "--help": result(oldHelp) }),
    });
    const compatibility = checkGrokCompatibility(snapshot, [
      "prompt_file",
      "no_subagents",
    ]);

    assert.equal(snapshot.capabilities.prompt_file, "unsupported");
    assert.equal(compatibility.ok, false);
    assert.deepEqual(compatibility.unsupported, ["prompt_file"]);
    assert.match(compatibility.correctiveAction || "", /update the Grok CLI/i);
  });

  it("treats malformed inspect evidence as unknown and returns one repair action", async () => {
    const snapshot = await probeGrokCapabilities({
      runner: fixtureRunner({ "inspect --json": result("{not-json") }),
    });
    const compatibility = checkGrokCompatibility(snapshot, ["inspect_json"]);

    assert.equal(snapshot.inspect.status, "invalid");
    assert.equal(snapshot.capabilities.inspect_json, "unknown");
    assert.equal(snapshot.errors.find((entry) => entry.probe === "inspect")?.code, "invalid_json");
    assert.equal(compatibility.ok, false);
    assert.deepEqual(compatibility.unknown, ["inspect_json"]);
    assert.match(compatibility.correctiveAction || "", /rerun capability preflight/i);
  });

  it("keeps help-derived support unknown after a bounded probe timeout", async () => {
    const snapshot = await probeGrokCapabilities({
      runner: fixtureRunner({
        "--help": result("", { code: null, error: "probe_timeout" }),
      }),
    });
    const compatibility = checkGrokCompatibility(snapshot, ["streaming_json"]);

    assert.equal(snapshot.capabilities.streaming_json, "unknown");
    assert.equal(compatibility.ok, false);
    assert.match(
      snapshot.errors.find((entry) => entry.probe === "help")?.correctiveAction || "",
      /bounded Grok help probe/i
    );
  });

  it("reports a missing binary without mistaking auth state for logged out", async () => {
    const missing: CliCaptureResult = {
      code: null,
      stdout: "",
      stderr: "",
      error: "ENOENT",
    };
    const snapshot = await probeGrokCapabilities({
      runner: async () => missing,
    });
    const compatibility = checkGrokCompatibility(snapshot, []);

    assert.equal(snapshot.binary.found, false);
    assert.equal(snapshot.auth.state, "unknown");
    assert.equal(compatibility.ok, false);
    assert.match(compatibility.correctiveAction || "", /install or repair/i);
  });
});

describe("Grok argv capability inference", () => {
  it("deduplicates the exact capabilities implied by a bounded leaf invocation", () => {
    assert.deepEqual(
      inferGrokCapabilitiesFromArgs([
        "--prompt-file",
        "brief.md",
        "--output-format",
        "streaming-json",
        "--no-subagents",
        "--max-turns",
        "8",
        "--resume",
        "session-id",
        "--fork-session",
        "--session-id",
        "new-session-id",
      ]),
      [
        "prompt_file",
        "streaming_json",
        "max_turns",
        "no_subagents",
        "exact_session",
        "fork_session",
      ]
    );
  });
});
