import { existsSync, readFileSync } from "fs";
import type { CustomAgentConfig, ExtensionPreferences } from "./types";
import { projectAgentsPath } from "./paths";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const PERMISSION_MODES = new Set([
  "manual",
  "plan",
  "acceptEdits",
  "auto",
  "bypass",
]);

export function sanitizeAgent(
  input: unknown,
  defaults: { source: CustomAgentConfig["source"] }
): CustomAgentConfig | null {
  if (!isObject(input)) return null;
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : typeof input.name === "string"
        ? input.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : null;
  if (!id) return null;
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : id;

  const permissionMode =
    typeof input.permissionMode === "string" &&
    PERMISSION_MODES.has(input.permissionMode)
      ? (input.permissionMode as CustomAgentConfig["permissionMode"])
      : undefined;

  return {
    id,
    name,
    description:
      typeof input.description === "string" ? input.description : undefined,
    model: typeof input.model === "string" ? input.model : undefined,
    systemPrompt:
      typeof input.systemPrompt === "string" ? input.systemPrompt : undefined,
    tools: Array.isArray(input.tools)
      ? input.tools.filter((t): t is string => typeof t === "string")
      : undefined,
    permissionMode,
    worktreeIsolation: input.worktreeIsolation === true,
    skills: Array.isArray(input.skills)
      ? input.skills.filter((s): s is string => typeof s === "string")
      : undefined,
    source: defaults.source,
    enabled: input.enabled !== false,
    pluginId: typeof input.pluginId === "string" ? input.pluginId : undefined,
  };
}

export function loadProjectAgents(cwd?: string): CustomAgentConfig[] {
  if (!cwd?.trim()) return [];
  const p = projectAgentsPath(cwd);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : isObject(raw) && Array.isArray(raw.agents)
        ? raw.agents
        : [];
    return list
      .map((a) => sanitizeAgent(a, { source: "project" }))
      .filter((a): a is CustomAgentConfig => !!a);
  } catch {
    return [];
  }
}

/** Built-in agent presets (metadata only — not auto-launched). */
export function builtinAgents(): CustomAgentConfig[] {
  return [
    {
      id: "builtin:explorer",
      name: "Explorer",
      description:
        "Read-only investigation agent. Prefer plan mode and search tools; no writes.",
      permissionMode: "plan",
      worktreeIsolation: false,
      tools: ["read", "grep", "glob", "search"],
      skills: [],
      source: "builtin",
      enabled: true,
    },
    {
      id: "builtin:implementer",
      name: "Implementer",
      description:
        "Default implementation agent. Edits in the trusted workspace with manual approvals.",
      permissionMode: "manual",
      worktreeIsolation: false,
      source: "builtin",
      enabled: true,
    },
    {
      id: "builtin:isolated-worker",
      name: "Isolated worker",
      description:
        "Runs in a Spok-managed worktree so the main checkout stays clean.",
      permissionMode: "acceptEdits",
      worktreeIsolation: true,
      source: "builtin",
      enabled: true,
    },
  ];
}

export function mergeAgents(opts: {
  builtin: CustomAgentConfig[];
  project: CustomAgentConfig[];
  plugin: CustomAgentConfig[];
  prefs: ExtensionPreferences;
}): CustomAgentConfig[] {
  const map = new Map<string, CustomAgentConfig>();
  for (const a of [...opts.builtin, ...opts.plugin, ...opts.project]) {
    map.set(a.id, { ...a });
  }
  for (const a of opts.prefs.agents) {
    const s = sanitizeAgent(a, { source: a.source || "user" });
    if (s) map.set(s.id, s);
  }
  return [...map.values()]
    .filter((a) => a.enabled !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { buildAgentBrief } from "./format";