/**
 * Versioned Grok CLI capability discovery and compatibility gate.
 *
 * This is server-only privileged adapter code. It deliberately keeps raw
 * `inspect --json` and help output out of the returned snapshot: callers get
 * bounded summaries plus content hashes that can be pinned to a mission/run.
 */

import { createHash } from "crypto";
import {
  captureCliCommand,
  type CliCaptureOptions,
  type CliCaptureResult,
} from "./cli-status";

export const GROK_CAPABILITY_SNAPSHOT_VERSION = 1 as const;

export const GROK_CAPABILITY_IDS = [
  "inspect_json",
  "inline_prompt",
  "prompt_file",
  "prompt_json",
  "model_selection",
  "agent_selection",
  "streaming_json",
  "structured_report",
  "max_turns",
  "reasoning_effort",
  "tool_policy",
  "web_policy",
  "always_approve",
  "permission_mode",
  "sandbox",
  "no_subagents",
  "no_memory",
  "no_plan",
  "check",
  "continue_latest",
  "exact_session",
  "fork_session",
  "leader_socket",
  "leader_health_json",
  "worktree",
  "worktree_ref",
  "trace",
  "export",
  "debug_file",
] as const;

export type GrokCapabilityId = (typeof GROK_CAPABILITY_IDS)[number];
export type GrokCapabilitySupport = "supported" | "unsupported" | "unknown";
export type GrokProbeStatus =
  | "available"
  | "not_requested"
  | "unsupported"
  | "invalid"
  | "timeout"
  | "failed";

export type GrokInspectSummary = {
  status: GrokProbeStatus;
  contentHash?: string;
  grokVersion: string | null;
  channel: string | null;
  projectTrusted: boolean | null;
  bridgeTrusted: boolean | null;
  projectRootPresent: boolean | null;
  apiKeyAuthDisabled: boolean | null;
  permissionSourceCount: number | null;
  skillCount: number | null;
  agentCount: number | null;
  pluginCount: number | null;
  mcpServerCount: number | null;
};

export type GrokLeaderHealth = {
  status: GrokProbeStatus;
  activeCount: number | null;
  contentHash?: string;
};

export type GrokCapabilityProbeError = {
  probe: "version" | "help" | "inspect" | "leader";
  code: string;
  correctiveAction: string;
};

export type GrokCapabilitySnapshot = {
  schemaVersion: typeof GROK_CAPABILITY_SNAPSHOT_VERSION;
  fingerprint: string;
  capturedAt: number;
  command: string;
  cwd: string;
  probeMs: number;
  binary: {
    found: boolean;
    version: string | null;
    commit: string | null;
    channel: string | null;
    versionHash?: string;
  };
  inspect: GrokInspectSummary;
  auth: {
    checked: false;
    state: "unknown";
    reason: "inspect_does_not_report_auth_state";
  };
  supportedFlags: string[];
  supportedCommands: string[];
  capabilities: Record<GrokCapabilityId, GrokCapabilitySupport>;
  leader: GrokLeaderHealth;
  errors: GrokCapabilityProbeError[];
};

export type GrokCompatibilityResult = {
  ok: boolean;
  snapshotVersion: typeof GROK_CAPABILITY_SNAPSHOT_VERSION;
  snapshotFingerprint: string;
  required: GrokCapabilityId[];
  unsupported: GrokCapabilityId[];
  unknown: GrokCapabilityId[];
  correctiveAction: string | null;
};

export type GrokCapabilityProbeRunner = (
  args: string[]
) => Promise<CliCaptureResult>;

export type ProbeGrokCapabilitiesOptions = {
  command?: string;
  cwd?: string;
  includeLeaderHealth?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?: () => number;
  runner?: GrokCapabilityProbeRunner;
};

const UNKNOWN_INSPECT: Omit<GrokInspectSummary, "status"> = {
  grokVersion: null,
  channel: null,
  projectTrusted: null,
  bridgeTrusted: null,
  projectRootPresent: null,
  apiKeyAuthDisabled: null,
  permissionSourceCount: null,
  skillCount: null,
  agentCount: null,
  pluginCount: null,
  mcpServerCount: null,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function combined(result: CliCaptureResult): string {
  return stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function parseVersion(value: string): {
  version: string | null;
  commit: string | null;
  channel: string | null;
} {
  const version = value.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/i)?.[1] ?? null;
  const commit = value.match(/\(([0-9a-f]{7,64})\)/i)?.[1] ?? null;
  const channel = value.match(/\[([a-z][\w.-]*)\]/i)?.[1] ?? null;
  return { version, commit, channel };
}

function parseSupportedFlags(help: string): string[] {
  const flags = new Set<string>();
  for (const match of help.matchAll(/(?:^|[\s,])(\-{2}[a-z][a-z0-9-]*)\b/gim)) {
    flags.add(match[1]);
  }
  return [...flags].sort();
}

function parseSupportedCommands(help: string): string[] {
  const commands = new Set<string>();
  for (const match of help.matchAll(/^[ \t]{2}([a-z][a-z0-9-]*)[ \t]{2,}\S/gim)) {
    commands.add(match[1].toLowerCase());
  }
  return [...commands].sort();
}

function statusForFailure(result: CliCaptureResult): GrokProbeStatus {
  if (result.error === "probe_timeout") return "timeout";
  return "failed";
}

function errorFor(
  probe: GrokCapabilityProbeError["probe"],
  result: CliCaptureResult,
  fallback: string
): GrokCapabilityProbeError {
  const code = result.error || `exit_${result.code ?? "unknown"}`;
  return {
    probe,
    code,
    correctiveAction:
      result.error === "probe_timeout"
        ? `Retry the bounded Grok ${probe} probe; if it hangs again, run it directly and repair the native CLI before launching the mission.`
        : fallback,
  };
}

function summarizeInspect(result: CliCaptureResult): GrokInspectSummary {
  if (result.code !== 0 || result.error) {
    return { status: statusForFailure(result), ...UNKNOWN_INSPECT };
  }
  const raw = result.stdout.trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { status: "invalid", ...UNKNOWN_INSPECT, contentHash: sha256(raw) };
    }
    const permissions = isRecord(parsed.permissions) ? parsed.permissions : {};
    const loginPolicy = isRecord(parsed.loginPolicy) ? parsed.loginPolicy : {};
    return {
      status: "available",
      contentHash: sha256(raw),
      grokVersion: stringOrNull(parsed.grokVersion),
      channel: stringOrNull(parsed.channel),
      projectTrusted: booleanOrNull(parsed.projectTrusted),
      bridgeTrusted: booleanOrNull(parsed.bridgeTrusted),
      projectRootPresent:
        parsed.projectRoot === undefined
          ? null
          : parsed.projectRoot === null
            ? false
            : stringOrNull(parsed.projectRoot) !== null,
      apiKeyAuthDisabled: booleanOrNull(loginPolicy.apiKeyAuthDisabled),
      permissionSourceCount: arrayLength(permissions.sources),
      skillCount: arrayLength(parsed.skills),
      agentCount: arrayLength(parsed.agents),
      pluginCount: arrayLength(parsed.plugins),
      mcpServerCount: arrayLength(parsed.mcpServers),
    };
  } catch {
    return { status: "invalid", ...UNKNOWN_INSPECT, contentHash: sha256(raw) };
  }
}

function summarizeLeader(
  requested: boolean,
  result: CliCaptureResult | undefined
): GrokLeaderHealth {
  if (!requested) return { status: "not_requested", activeCount: null };
  if (!result || result.code !== 0 || result.error) {
    return {
      status: result ? statusForFailure(result) : "failed",
      activeCount: null,
    };
  }
  const raw = result.stdout.trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { status: "invalid", activeCount: null, contentHash: sha256(raw) };
    }
    return {
      status: "available",
      activeCount: parsed.length,
      contentHash: sha256(raw),
    };
  } catch {
    return { status: "invalid", activeCount: null, contentHash: sha256(raw) };
  }
}

function supportFromHelp(
  helpAvailable: boolean,
  present: boolean
): GrokCapabilitySupport {
  if (!helpAvailable) return "unknown";
  return present ? "supported" : "unsupported";
}

function capabilityMap(input: {
  helpAvailable: boolean;
  helpText: string;
  flags: Set<string>;
  commands: Set<string>;
  inspect: GrokInspectSummary;
  leader: GrokLeaderHealth;
}): Record<GrokCapabilityId, GrokCapabilitySupport> {
  const { helpAvailable, helpText, flags, commands, inspect, leader } = input;
  const hasFlag = (flag: string) => flags.has(flag);
  const hasCommand = (command: string) => commands.has(command);
  const fromHelp = (present: boolean) => supportFromHelp(helpAvailable, present);
  return {
    inspect_json:
      inspect.status === "available"
        ? "supported"
        : helpAvailable && !hasCommand("inspect")
          ? "unsupported"
          : "unknown",
    inline_prompt: fromHelp(hasFlag("--prompt")),
    prompt_file: fromHelp(hasFlag("--prompt-file")),
    prompt_json: fromHelp(hasFlag("--prompt-json")),
    model_selection: fromHelp(hasFlag("--model")),
    agent_selection: fromHelp(hasFlag("--agent")),
    streaming_json: fromHelp(
      hasFlag("--output-format") && /\bstreaming-json\b/i.test(helpText)
    ),
    structured_report: fromHelp(
      hasFlag("--json-schema") && hasFlag("--output-format")
    ),
    max_turns: fromHelp(hasFlag("--max-turns")),
    reasoning_effort: fromHelp(hasFlag("--reasoning-effort")),
    tool_policy: fromHelp(
      hasFlag("--tools") && hasFlag("--disallowed-tools")
    ),
    web_policy: fromHelp(hasFlag("--disable-web-search")),
    always_approve: fromHelp(hasFlag("--always-approve")),
    permission_mode: fromHelp(hasFlag("--permission-mode")),
    sandbox: fromHelp(hasFlag("--sandbox")),
    no_subagents: fromHelp(hasFlag("--no-subagents")),
    no_memory: fromHelp(hasFlag("--no-memory")),
    no_plan: fromHelp(hasFlag("--no-plan")),
    check: fromHelp(hasFlag("--check")),
    continue_latest: fromHelp(hasFlag("--continue")),
    exact_session: fromHelp(
      hasFlag("--session-id") && hasFlag("--resume")
    ),
    fork_session: fromHelp(
      hasFlag("--fork-session") && hasFlag("--resume")
    ),
    leader_socket: fromHelp(hasFlag("--leader-socket")),
    leader_health_json:
      leader.status === "available"
        ? "supported"
        : !helpAvailable
          ? "unknown"
          : !hasCommand("leader")
            ? "unsupported"
            : leader.status === "not_requested"
              ? "unknown"
              : "unknown",
    worktree: fromHelp(hasCommand("worktree") && hasFlag("--worktree")),
    worktree_ref: fromHelp(hasFlag("--worktree-ref")),
    trace: fromHelp(hasCommand("trace")),
    export: fromHelp(hasCommand("export")),
    debug_file: fromHelp(hasFlag("--debug-file")),
  };
}

function snapshotFingerprint(
  snapshot: Omit<GrokCapabilitySnapshot, "fingerprint" | "capturedAt" | "probeMs">
): string {
  return sha256(JSON.stringify(snapshot));
}

export async function probeGrokCapabilities(
  options: ProbeGrokCapabilitiesOptions = {}
): Promise<GrokCapabilitySnapshot> {
  const command = options.command?.trim() || process.env.SPOK_GROK_CMD?.trim() || "grok";
  const cwd = options.cwd || process.cwd();
  const now = options.now ?? Date.now;
  const started = now();
  const captureOptions: CliCaptureOptions = {
    cwd,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  };
  const runner =
    options.runner ??
    ((args: string[]) => captureCliCommand(command, args, captureOptions));

  const safeRun = async (args: string[]): Promise<CliCaptureResult> => {
    try {
      return await runner(args);
    } catch (error) {
      return {
        code: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.name || "probe_error" : "probe_error",
      };
    }
  };

  const includeLeaderHealth = options.includeLeaderHealth === true;
  const [versionResult, helpResult, inspectResult, leaderResult] = await Promise.all([
    safeRun(["--version"]),
    safeRun(["--help"]),
    safeRun(["inspect", "--json"]),
    includeLeaderHealth
      ? safeRun(["leader", "list", "--json"])
      : Promise.resolve(undefined),
  ]);

  const versionText = combined(versionResult);
  const versionParts = parseVersion(versionText);
  const helpText = helpResult.code === 0 && !helpResult.error ? combined(helpResult) : "";
  const supportedFlags = parseSupportedFlags(helpText);
  const supportedCommands = parseSupportedCommands(helpText);
  const inspect = summarizeInspect(inspectResult);
  const leader = summarizeLeader(includeLeaderHealth, leaderResult);
  const found = [versionResult, helpResult, inspectResult].some(
    (result) => result.code === 0 && !result.error
  );
  const errors: GrokCapabilityProbeError[] = [];

  if (versionResult.code !== 0 || versionResult.error) {
    errors.push(
      errorFor(
        "version",
        versionResult,
        "Install or repair the native Grok CLI, then retry capability preflight."
      )
    );
  }
  if (helpResult.code !== 0 || helpResult.error) {
    errors.push(
      errorFor(
        "help",
        helpResult,
        "Run `grok --help` directly and repair or update the CLI before launching the mission."
      )
    );
  }
  if (inspect.status !== "available") {
    errors.push(
      inspect.status === "invalid"
        ? {
            probe: "inspect",
            code: "invalid_json",
            correctiveAction:
              "Run `grok inspect --json` directly and update or repair the CLI until it returns valid JSON.",
          }
        : errorFor(
            "inspect",
            inspectResult,
            "Run `grok inspect --json` directly and repair or update the CLI before launching the mission."
          )
    );
  }
  if (includeLeaderHealth && leader.status !== "available" && leaderResult) {
    errors.push(
      leader.status === "invalid"
        ? {
            probe: "leader",
            code: "invalid_json",
            correctiveAction:
              "Run `grok leader list --json` directly and repair leader diagnostics before selecting shared leader mode.",
          }
        : errorFor(
            "leader",
            leaderResult,
            "Repair the Grok leader backend or select a bounded direct run before launching shared lanes."
          )
    );
  }

  const capabilities = capabilityMap({
    helpAvailable: helpText.length > 0,
    helpText,
    flags: new Set(supportedFlags),
    commands: new Set(supportedCommands),
    inspect,
    leader,
  });
  const binaryVersion = versionParts.version ?? inspect.grokVersion;
  const binaryChannel = versionParts.channel ?? inspect.channel;
  const withoutFingerprint: Omit<
    GrokCapabilitySnapshot,
    "fingerprint" | "capturedAt" | "probeMs"
  > = {
    schemaVersion: GROK_CAPABILITY_SNAPSHOT_VERSION,
    command,
    cwd,
    binary: {
      found,
      version: binaryVersion,
      commit: versionParts.commit,
      channel: binaryChannel,
      ...(versionText ? { versionHash: sha256(versionText) } : {}),
    },
    inspect,
    auth: {
      checked: false,
      state: "unknown",
      reason: "inspect_does_not_report_auth_state",
    },
    supportedFlags,
    supportedCommands,
    capabilities,
    leader,
    errors,
  };

  return {
    ...withoutFingerprint,
    fingerprint: snapshotFingerprint(withoutFingerprint),
    capturedAt: now(),
    probeMs: Math.max(0, now() - started),
  };
}

export function checkGrokCompatibility(
  snapshot: GrokCapabilitySnapshot,
  required: readonly GrokCapabilityId[]
): GrokCompatibilityResult {
  const normalized = [...new Set(required)];
  const unsupported = normalized.filter(
    (id) => snapshot.capabilities[id] === "unsupported"
  );
  const unknown = normalized.filter(
    (id) => snapshot.capabilities[id] === "unknown"
  );
  let correctiveAction: string | null = null;
  if (!snapshot.binary.found) {
    correctiveAction =
      "Install or repair the native Grok CLI, then rerun mission preflight.";
  } else if (unsupported.length > 0) {
    correctiveAction = `Update the Grok CLI or revise the run contract; required capabilities are unsupported: ${unsupported.join(", ")}.`;
  } else if (unknown.length > 0) {
    correctiveAction = `Rerun capability preflight and repair the failed probe before launch; support is unknown for: ${unknown.join(", ")}.`;
  }
  return {
    ok: snapshot.binary.found && unsupported.length === 0 && unknown.length === 0,
    snapshotVersion: GROK_CAPABILITY_SNAPSHOT_VERSION,
    snapshotFingerprint: snapshot.fingerprint,
    required: normalized,
    unsupported,
    unknown,
    correctiveAction,
  };
}

/** Required discovered capabilities implied by an already-compiled argv list. */
export function inferGrokCapabilitiesFromArgs(
  args: readonly string[]
): GrokCapabilityId[] {
  const required = new Set<GrokCapabilityId>();
  const has = (flag: string) => args.includes(flag);
  if (has("--single") || has("--prompt") || has("-p")) {
    required.add("inline_prompt");
  }
  if (has("--prompt-file")) required.add("prompt_file");
  if (has("--prompt-json")) required.add("prompt_json");
  if (has("--model")) required.add("model_selection");
  if (has("--agent")) required.add("agent_selection");
  if (
    args.some(
      (value, index) =>
        value === "--output-format" && args[index + 1] === "streaming-json"
    )
  ) {
    required.add("streaming_json");
  }
  if (has("--json-schema")) required.add("structured_report");
  if (has("--max-turns")) required.add("max_turns");
  if (has("--reasoning-effort")) required.add("reasoning_effort");
  if (has("--tools") || has("--disallowed-tools")) required.add("tool_policy");
  if (has("--disable-web-search")) required.add("web_policy");
  if (has("--always-approve")) required.add("always_approve");
  if (has("--permission-mode")) required.add("permission_mode");
  if (has("--sandbox")) required.add("sandbox");
  if (has("--no-subagents")) required.add("no_subagents");
  if (has("--no-memory")) required.add("no_memory");
  if (has("--no-plan")) required.add("no_plan");
  if (has("--check")) required.add("check");
  if (has("--continue")) required.add("continue_latest");
  if (has("--resume") || has("-r") || has("--session-id") || has("-s")) {
    required.add("exact_session");
  }
  if (has("--fork-session")) required.add("fork_session");
  if (has("--leader-socket")) required.add("leader_socket");
  if (has("--worktree") || has("-w")) required.add("worktree");
  if (has("--worktree-ref") || has("--ref")) required.add("worktree_ref");
  if (has("--debug-file")) required.add("debug_file");
  return [...required];
}

export function isGrokCapabilityId(value: string): value is GrokCapabilityId {
  return (GROK_CAPABILITY_IDS as readonly string[]).includes(value);
}
