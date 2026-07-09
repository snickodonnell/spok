/**
 * Extensibility layer contracts (Phase 4).
 *
 * Skills, MCP servers, hooks, plugins, and custom agents.
 * Privileged discovery/execution always goes through local APIs + policy.
 */

export type ExtensionSource = "project" | "user" | "plugin" | "builtin";

export type ExtensionTrustState =
  | "trusted"
  | "untrusted"
  | "denied"
  | "pending_review";

/** Skill frontmatter + discovery metadata (body loaded on demand). */
export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  /** Absolute path to SKILL.md */
  path: string;
  /** Directory containing SKILL.md */
  dir: string;
  source: ExtensionSource;
  /** Plugin id when source is plugin */
  pluginId?: string;
  /** Optional tags from frontmatter */
  tags?: string[];
  /** Whether user disabled this skill in Spok UI */
  enabled: boolean;
  /** Byte size of SKILL.md when known */
  sizeBytes?: number;
  /** True when description came only from frontmatter (body not loaded). */
  frontmatterOnly?: boolean;
}

export type McpTransport = "stdio" | "sse" | "http";

export type McpToolApprovalState =
  | "unknown"
  | "allow"
  | "ask"
  | "deny"
  | "untrusted";

/** Declared or discovered MCP tool (read-only listing in Phase 4). */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  /** Server that owns this tool */
  serverId: string;
  /** Input schema summary (not full JSON Schema dump in UI). */
  inputSummary?: string;
  approval: McpToolApprovalState;
  /** True when tool was declared in config, not live-probed. */
  declared: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: McpTransport;
  /** stdio: command to spawn */
  command?: string;
  args?: string[];
  /** sse/http: remote URL */
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  source: ExtensionSource;
  trust: ExtensionTrustState;
  /** Optional static tool declarations (no live MCP client required). */
  tools?: Array<{ name: string; description?: string; inputSummary?: string }>;
  /** Last successful tool list timestamp */
  lastProbedAt?: number;
  pluginId?: string;
}

export type HookEvent =
  | "session_start"
  | "session_end"
  | "prompt_submit"
  | "pre_tool_use"
  | "post_tool_use"
  | "permission_request"
  | "file_changed"
  | "stop"
  | "subagent_start"
  | "subagent_end";

export type HookKind =
  /** Inject a system/trace event into the session (always safe). */
  | "trace"
  /** Run a shell command (requires trust + policy). */
  | "command"
  /** Spok-internal notify only (toast / status). */
  | "notify";

export interface HookDefinition {
  id: string;
  name: string;
  description?: string;
  events: HookEvent[];
  kind: HookKind;
  enabled: boolean;
  source: ExtensionSource;
  trust: ExtensionTrustState;
  /** For kind=trace: static message template (supports {{sessionId}}, {{cwd}}, {{event}}). */
  message?: string;
  /** For kind=command: binary + args (no shell). */
  command?: string;
  args?: string[];
  /** Timeout ms for command hooks */
  timeoutMs?: number;
  pluginId?: string;
  /** Path of file that defined the hook (for audit). */
  configPath?: string;
}

export interface HookRunRequest {
  event: HookEvent;
  sessionId: string;
  cwd?: string;
  /** Optional extra template vars */
  vars?: Record<string, string>;
  /** Only run hooks that match these ids (optional). */
  hookIds?: string[];
}

export interface HookRunResult {
  hookId: string;
  hookName: string;
  event: HookEvent;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  /** Stream-event shaped payloads for the client to apply. */
  events: Array<{
    type: "system" | "error" | "message";
    title: string;
    content: string;
    status: "success" | "error" | "skipped" | "pending";
    meta?: Record<string, unknown>;
  }>;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

/** Plugin packaging manifest (draft). */
export interface PluginManifest {
  /** Schema id for the draft format */
  schema: "spok.plugin/v1";
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Relative dirs under plugin root */
  skills?: string[];
  /** Inline or relative MCP configs */
  mcp?: Array<Omit<McpServerConfig, "id" | "source" | "trust" | "enabled"> & {
    id?: string;
    enabled?: boolean;
  }>;
  hooks?: Array<
    Omit<HookDefinition, "id" | "source" | "trust" | "enabled"> & {
      id?: string;
      enabled?: boolean;
    }
  >;
  /** Slash / app command contributions (metadata only in Phase 4). */
  commands?: Array<{
    name: string;
    description: string;
    argsHint?: string;
  }>;
  agents?: Array<
    Omit<CustomAgentConfig, "id" | "source" | "enabled"> & {
      id?: string;
      enabled?: boolean;
    }
  >;
  homepage?: string;
}

export interface PluginDescriptor {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  path: string;
  manifestPath: string;
  source: ExtensionSource;
  enabled: boolean;
  trust: ExtensionTrustState;
  /** Counts for UI badges */
  skillCount: number;
  mcpCount: number;
  hookCount: number;
  agentCount: number;
  commandCount: number;
  manifest: PluginManifest;
}

/** Custom agent / subagent config model. */
export interface CustomAgentConfig {
  id: string;
  name: string;
  description?: string;
  /** Optional model override */
  model?: string;
  /** System / role prompt (not auto-injected until user picks the agent). */
  systemPrompt?: string;
  /** Tool allowlist; empty = inherit default */
  tools?: string[];
  /** Preferred permission mode when launching */
  permissionMode?: "manual" | "plan" | "acceptEdits" | "auto" | "bypass";
  /** Prefer isolated worktree for this agent */
  worktreeIsolation?: boolean;
  /** Skill ids to attach by default when this agent is selected */
  skills?: string[];
  source: ExtensionSource;
  enabled: boolean;
  pluginId?: string;
}

/** User/project extension preferences (enable/disable, trust). */
export interface ExtensionPreferences {
  version: 1;
  /** skill id → enabled */
  skills: Record<string, boolean>;
  /** mcp server id → partial override */
  mcp: Record<
    string,
    {
      enabled?: boolean;
      trust?: ExtensionTrustState;
    }
  >;
  /** hook id → partial override */
  hooks: Record<
    string,
    {
      enabled?: boolean;
      trust?: ExtensionTrustState;
    }
  >;
  /** plugin id → partial override */
  plugins: Record<
    string,
    {
      enabled?: boolean;
      trust?: ExtensionTrustState;
    }
  >;
  /** Full custom agents owned by user/project (not plugin-sourced). */
  agents: CustomAgentConfig[];
  /** User-defined MCP servers (not discovered from plugins). */
  userMcpServers: McpServerConfig[];
  /** User-defined hooks. */
  userHooks: HookDefinition[];
}

export interface ExtensionsBundle {
  skills: SkillDescriptor[];
  mcpServers: McpServerConfig[];
  mcpTools: McpToolDescriptor[];
  hooks: HookDefinition[];
  plugins: PluginDescriptor[];
  agents: CustomAgentConfig[];
  preferences: ExtensionPreferences;
  roots: {
    projectAgents?: string;
    projectSpok?: string;
    userSkills?: string;
    userPlugins?: string;
    userExtensions?: string;
  };
}

export const HOOK_EVENT_META: Record<
  HookEvent,
  { label: string; description: string }
> = {
  session_start: {
    label: "Session start",
    description: "When a workspace session is created or opened.",
  },
  session_end: {
    label: "Session end",
    description: "When a session completes successfully.",
  },
  prompt_submit: {
    label: "Prompt submit",
    description: "Before a prompt is sent to the agent CLI.",
  },
  pre_tool_use: {
    label: "Pre tool use",
    description: "Before a tool call is accepted (when provider supports it).",
  },
  post_tool_use: {
    label: "Post tool use",
    description: "After a tool call finishes.",
  },
  permission_request: {
    label: "Permission request",
    description: "When an approval overlay is shown.",
  },
  file_changed: {
    label: "File changed",
    description: "When the harness observes file diffs.",
  },
  stop: {
    label: "Stop",
    description: "When a run is stopped or the process exits.",
  },
  subagent_start: {
    label: "Subagent start",
    description: "When a subagent lane begins.",
  },
  subagent_end: {
    label: "Subagent end",
    description: "When a subagent lane ends.",
  },
};

export function emptyExtensionPreferences(): ExtensionPreferences {
  return {
    version: 1,
    skills: {},
    mcp: {},
    hooks: {},
    plugins: {},
    agents: [],
    userMcpServers: [],
    userHooks: [],
  };
}
