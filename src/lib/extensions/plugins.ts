import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import path from "path";
import type {
  CustomAgentConfig,
  ExtensionPreferences,
  ExtensionSource,
  ExtensionTrustState,
  HookDefinition,
  McpServerConfig,
  PluginDescriptor,
  PluginManifest,
  SkillDescriptor,
} from "./types";
import {
  getUserPluginsRoot,
  projectPluginsDir,
} from "./paths";
import { discoverSkillsInRoot } from "./skills";
import { sanitizeMcpServer } from "./mcp";
import { sanitizeHook } from "./hooks";
import { sanitizeAgent } from "./agents";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const MANIFEST_NAMES = [
  "spok.plugin.json",
  "plugin.json",
  "spok-plugin.json",
];

export function parsePluginManifest(raw: unknown): PluginManifest | null {
  if (!isObject(raw)) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : typeof raw.name === "string"
        ? raw.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
        : null;
  if (!id) return null;
  const name =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const version =
    typeof raw.version === "string" && raw.version.trim()
      ? raw.version.trim()
      : "0.0.0";

  return {
    schema: "spok.plugin/v1",
    id,
    name,
    version,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    author: typeof raw.author === "string" ? raw.author : undefined,
    skills: Array.isArray(raw.skills)
      ? raw.skills.filter((s): s is string => typeof s === "string")
      : undefined,
    mcp: Array.isArray(raw.mcp) ? (raw.mcp as PluginManifest["mcp"]) : undefined,
    hooks: Array.isArray(raw.hooks)
      ? (raw.hooks as PluginManifest["hooks"])
      : undefined,
    commands: Array.isArray(raw.commands)
      ? raw.commands
          .filter((c): c is Record<string, unknown> => isObject(c))
          .map((c) => ({
            name: String(c.name || ""),
            description: String(c.description || ""),
            argsHint:
              typeof c.argsHint === "string" ? c.argsHint : undefined,
          }))
          .filter((c) => c.name)
      : undefined,
    agents: Array.isArray(raw.agents)
      ? (raw.agents as PluginManifest["agents"])
      : undefined,
    homepage: typeof raw.homepage === "string" ? raw.homepage : undefined,
  };
}

function findManifest(pluginDir: string): string | null {
  for (const name of MANIFEST_NAMES) {
    const p = path.join(pluginDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function loadPluginFromDir(
  pluginDir: string,
  source: ExtensionSource,
  prefs: ExtensionPreferences
): PluginDescriptor | null {
  const manifestPath = findManifest(pluginDir);
  if (!manifestPath) return null;
  let manifest: PluginManifest | null;
  try {
    manifest = parsePluginManifest(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown
    );
  } catch {
    return null;
  }
  if (!manifest) return null;

  const id = manifest.id;
  const ov = prefs.plugins[id];
  const trust: ExtensionTrustState =
    ov?.trust ?? (source === "user" ? "trusted" : "untrusted");
  const enabled = ov?.enabled !== false;

  // Count contributions (including skills dirs)
  let skillCount = 0;
  const skillDirs = manifest.skills?.length
    ? manifest.skills
    : [".agents/skills", "skills"];
  for (const rel of skillDirs) {
    const root = path.join(pluginDir, rel);
    if (existsSync(root)) {
      try {
        skillCount += readdirSync(root).filter((e) => {
          try {
            return statSync(path.join(root, e)).isDirectory();
          } catch {
            return false;
          }
        }).length;
      } catch {
        /* ignore */
      }
    }
  }

  return {
    id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    path: pluginDir,
    manifestPath,
    source,
    enabled,
    trust,
    skillCount,
    mcpCount: manifest.mcp?.length ?? 0,
    hookCount: manifest.hooks?.length ?? 0,
    agentCount: manifest.agents?.length ?? 0,
    commandCount: manifest.commands?.length ?? 0,
    manifest,
  };
}

export function discoverPluginsInRoot(
  root: string,
  source: ExtensionSource,
  prefs: ExtensionPreferences
): PluginDescriptor[] {
  if (!root || !existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: PluginDescriptor[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(root, entry);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const plugin = loadPluginFromDir(full, source, prefs);
    if (plugin) out.push(plugin);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverAllPlugins(
  cwd: string | undefined,
  prefs: ExtensionPreferences
): PluginDescriptor[] {
  const user = discoverPluginsInRoot(getUserPluginsRoot(), "user", prefs);
  const project = cwd
    ? discoverPluginsInRoot(projectPluginsDir(cwd), "project", prefs)
    : [];
  const map = new Map<string, PluginDescriptor>();
  for (const p of [...project, ...user]) map.set(p.id, p);
  return [...map.values()];
}

/** Expand enabled trusted plugins into skills / mcp / hooks / agents. */
export function expandPluginContributions(
  plugins: PluginDescriptor[],
  prefs: ExtensionPreferences
): {
  skills: SkillDescriptor[];
  mcp: McpServerConfig[];
  hooks: HookDefinition[];
  agents: CustomAgentConfig[];
} {
  const skills: SkillDescriptor[] = [];
  const mcp: McpServerConfig[] = [];
  const hooks: HookDefinition[] = [];
  const agents: CustomAgentConfig[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled || plugin.trust === "denied") continue;
    const trust: ExtensionTrustState =
      plugin.trust === "trusted" ? "trusted" : "untrusted";

    const skillDirs = plugin.manifest.skills?.length
      ? plugin.manifest.skills
      : [".agents/skills", "skills"];
    for (const rel of skillDirs) {
      const root = path.join(plugin.path, rel);
      skills.push(
        ...discoverSkillsInRoot(root, "plugin", {
          enabledMap: prefs.skills,
          pluginId: plugin.id,
        })
      );
    }

    for (const m of plugin.manifest.mcp ?? []) {
      const s = sanitizeMcpServer(
        { ...m, id: m.id || `${plugin.id}-${m.name || "mcp"}`, pluginId: plugin.id },
        { source: "plugin", trust }
      );
      if (s) mcp.push(s);
    }

    for (const h of plugin.manifest.hooks ?? []) {
      const hook = sanitizeHook(
        {
          ...h,
          id: h.id || `${plugin.id}-${h.name || "hook"}`,
          pluginId: plugin.id,
        },
        { source: "plugin", trust }
      );
      if (hook) hooks.push(hook);
    }

    for (const a of plugin.manifest.agents ?? []) {
      const agent = sanitizeAgent(
        {
          ...a,
          id: a.id || `${plugin.id}-${a.name || "agent"}`,
          pluginId: plugin.id,
        },
        { source: "plugin" }
      );
      if (agent) agents.push(agent);
    }
  }

  return { skills, mcp, hooks, agents };
}
