import { existsSync, readFileSync } from "fs";
import type {
  ExtensionPreferences,
  ExtensionTrustState,
  McpServerConfig,
  McpToolApprovalState,
  McpToolDescriptor,
} from "./types";
import { projectMcpPath } from "./paths";
import { evaluatePolicy } from "@/lib/security/permission-policy";
import type { SpokSettings } from "@/lib/settings/types";
import { listApprovalGrants } from "@/lib/security/approvals";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function sanitizeMcpServer(
  input: unknown,
  defaults: {
    source: McpServerConfig["source"];
    trust?: ExtensionTrustState;
  }
): McpServerConfig | null {
  if (!isObject(input)) return null;
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : typeof input.name === "string"
        ? slugId(input.name)
        : null;
  if (!id) return null;
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : id;
  const transport =
    input.transport === "sse" || input.transport === "http"
      ? input.transport
      : "stdio";

  const tools = Array.isArray(input.tools)
    ? input.tools
        .filter((t): t is Record<string, unknown> => isObject(t))
        .map((t) => ({
          name: String(t.name || "").trim(),
          description:
            typeof t.description === "string" ? t.description : undefined,
          inputSummary:
            typeof t.inputSummary === "string" ? t.inputSummary : undefined,
        }))
        .filter((t) => t.name)
    : undefined;

  const env =
    isObject(input.env)
      ? Object.fromEntries(
          Object.entries(input.env)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, String(v)])
        )
      : undefined;

  return {
    id,
    name,
    description:
      typeof input.description === "string" ? input.description : undefined,
    transport,
    command: typeof input.command === "string" ? input.command : undefined,
    args: Array.isArray(input.args)
      ? input.args.filter((a): a is string => typeof a === "string")
      : undefined,
    url: typeof input.url === "string" ? input.url : undefined,
    env,
    enabled: input.enabled !== false,
    source: defaults.source,
    trust: defaults.trust ?? (defaults.source === "user" ? "trusted" : "untrusted"),
    tools,
    pluginId: typeof input.pluginId === "string" ? input.pluginId : undefined,
    lastProbedAt:
      typeof input.lastProbedAt === "number" ? input.lastProbedAt : undefined,
  };
}

function slugId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "mcp-server";
}

/** Load project `.spok/mcp.json` if present. */
export function loadProjectMcpServers(cwd?: string): McpServerConfig[] {
  if (!cwd?.trim()) return [];
  const p = projectMcpPath(cwd);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : isObject(raw) && Array.isArray(raw.servers)
        ? raw.servers
        : isObject(raw) && isObject(raw.mcpServers)
          ? Object.entries(raw.mcpServers).map(([id, v]) =>
              isObject(v) ? { ...v, id: (v.id as string) || id } : null
            )
          : [];
    return list
      .map((s) =>
        sanitizeMcpServer(s, { source: "project", trust: "untrusted" })
      )
      .filter((s): s is McpServerConfig => !!s);
  } catch {
    return [];
  }
}

/** Merge user, project, plugin MCP servers with preference overrides. */
export function mergeMcpServers(opts: {
  user: McpServerConfig[];
  project: McpServerConfig[];
  plugin: McpServerConfig[];
  prefs: ExtensionPreferences;
}): McpServerConfig[] {
  const map = new Map<string, McpServerConfig>();
  for (const s of [...opts.plugin, ...opts.project, ...opts.user]) {
    map.set(s.id, { ...s });
  }
  for (const [id, ov] of Object.entries(opts.prefs.mcp)) {
    const cur = map.get(id);
    if (!cur) continue;
    if (ov.enabled !== undefined) cur.enabled = ov.enabled;
    if (ov.trust) cur.trust = ov.trust;
  }
  // User-defined servers from prefs
  for (const s of opts.prefs.userMcpServers) {
    const sanitized = sanitizeMcpServer(s, {
      source: "user",
      trust: s.trust ?? "trusted",
    });
    if (sanitized) {
      const ov = opts.prefs.mcp[sanitized.id];
      if (ov?.enabled !== undefined) sanitized.enabled = ov.enabled;
      if (ov?.trust) sanitized.trust = ov.trust;
      map.set(sanitized.id, sanitized);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build read-only tool list from declared tools + policy approval state.
 * Phase 4 does not invoke MCP; live probing is reserved for a later client.
 */
export function listMcpToolsReadOnly(
  servers: McpServerConfig[],
  settings: SpokSettings
): McpToolDescriptor[] {
  const grants = listApprovalGrants();
  const tools: McpToolDescriptor[] = [];

  for (const server of servers) {
    if (!server.enabled) continue;
    const declared = server.tools ?? [];
    // Placeholder visibility when no tools declared yet
    if (!declared.length) {
      tools.push({
        name: `${server.id}/*`,
        description:
          server.trust === "trusted"
            ? "No tools declared yet — add tool metadata or probe later."
            : "Server untrusted — review in Extension Center before use.",
        serverId: server.id,
        approval: trustToApproval(server.trust),
        declared: false,
      });
      continue;
    }
    for (const t of declared) {
      const approval = resolveMcpToolApproval(server, t.name, settings, grants);
      tools.push({
        name: t.name,
        description: t.description,
        serverId: server.id,
        inputSummary: t.inputSummary,
        approval,
        declared: true,
      });
    }
  }
  return tools;
}

function trustToApproval(trust: ExtensionTrustState): McpToolApprovalState {
  if (trust === "trusted") return "ask";
  if (trust === "denied") return "deny";
  if (trust === "pending_review") return "untrusted";
  return "untrusted";
}

function resolveMcpToolApproval(
  server: McpServerConfig,
  toolName: string,
  settings: SpokSettings,
  grants: ReturnType<typeof listApprovalGrants>
): McpToolApprovalState {
  if (!server.enabled || server.trust === "denied") return "deny";
  if (server.trust === "untrusted" || server.trust === "pending_review") {
    return "untrusted";
  }

  const decision = evaluatePolicy({
    settings,
    action: "mcp",
    command: `mcp:${server.id}`,
    args: [toolName],
    path: toolName,
    grants,
  });

  if (decision.decision === "deny") return "deny";
  if (decision.decision === "allow" && !decision.requiresApproval) return "allow";
  return "ask";
}

/** Redact env values for UI display. */
export function redactMcpEnvForDisplay(
  env?: Record<string, string>
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (/key|token|secret|password|auth|credential/i.test(k)) {
      out[k] = "••••••••";
    } else {
      out[k] = v.length > 80 ? `${v.slice(0, 40)}…` : v;
    }
  }
  return out;
}
