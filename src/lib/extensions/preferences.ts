import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type {
  CustomAgentConfig,
  ExtensionPreferences,
  HookDefinition,
  McpServerConfig,
} from "./types";
import { emptyExtensionPreferences } from "./types";
import {
  getUserExtensionsPath,
  projectExtensionsPath,
  projectSpokDir,
  ensureUserExtensionDirs,
} from "./paths";
import { sanitizeAgent } from "./agents";
import { sanitizeHook } from "./hooks";
import { sanitizeMcpServer } from "./mcp";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function sanitizePreferences(input: unknown): ExtensionPreferences {
  const base = emptyExtensionPreferences();
  if (!isObject(input)) return base;

  if (isObject(input.skills)) {
    for (const [k, v] of Object.entries(input.skills)) {
      if (typeof v === "boolean") base.skills[k] = v;
    }
  }
  if (isObject(input.mcp)) {
    for (const [k, v] of Object.entries(input.mcp)) {
      if (!isObject(v)) continue;
      base.mcp[k] = {
        enabled: typeof v.enabled === "boolean" ? v.enabled : undefined,
        trust:
          v.trust === "trusted" ||
          v.trust === "untrusted" ||
          v.trust === "denied" ||
          v.trust === "pending_review"
            ? v.trust
            : undefined,
      };
    }
  }
  if (isObject(input.hooks)) {
    for (const [k, v] of Object.entries(input.hooks)) {
      if (!isObject(v)) continue;
      base.hooks[k] = {
        enabled: typeof v.enabled === "boolean" ? v.enabled : undefined,
        trust:
          v.trust === "trusted" ||
          v.trust === "untrusted" ||
          v.trust === "denied" ||
          v.trust === "pending_review"
            ? v.trust
            : undefined,
      };
    }
  }
  if (isObject(input.plugins)) {
    for (const [k, v] of Object.entries(input.plugins)) {
      if (!isObject(v)) continue;
      base.plugins[k] = {
        enabled: typeof v.enabled === "boolean" ? v.enabled : undefined,
        trust:
          v.trust === "trusted" ||
          v.trust === "untrusted" ||
          v.trust === "denied" ||
          v.trust === "pending_review"
            ? v.trust
            : undefined,
      };
    }
  }
  if (Array.isArray(input.agents)) {
    base.agents = input.agents
      .map((a) => sanitizeAgent(a, { source: "user" }))
      .filter((a): a is CustomAgentConfig => !!a);
  }
  if (Array.isArray(input.userMcpServers)) {
    base.userMcpServers = input.userMcpServers
      .map((s) => sanitizeMcpServer(s, { source: "user", trust: "trusted" }))
      .filter((s): s is McpServerConfig => !!s);
  }
  if (Array.isArray(input.userHooks)) {
    base.userHooks = input.userHooks
      .map((h) => sanitizeHook(h, { source: "user", trust: "trusted" }))
      .filter((h): h is HookDefinition => !!h);
  }
  return base;
}

function readPrefsFile(filePath: string): ExtensionPreferences {
  if (!existsSync(filePath)) return emptyExtensionPreferences();
  try {
    return sanitizePreferences(
      JSON.parse(readFileSync(filePath, "utf8")) as unknown
    );
  } catch {
    return emptyExtensionPreferences();
  }
}

export function loadUserExtensionPreferences(): ExtensionPreferences {
  return readPrefsFile(getUserExtensionsPath());
}

export function loadProjectExtensionPreferences(
  cwd?: string
): ExtensionPreferences {
  if (!cwd?.trim()) return emptyExtensionPreferences();
  return readPrefsFile(projectExtensionsPath(cwd));
}

/**
 * Merge user + project extension preferences.
 * Project wins on skill/mcp/hook/plugin toggles; agents/mcp/hooks lists concatenate with id override.
 */
export function mergeExtensionPreferences(
  user: ExtensionPreferences,
  project: ExtensionPreferences
): ExtensionPreferences {
  return {
    version: 1,
    skills: { ...user.skills, ...project.skills },
    mcp: { ...user.mcp, ...project.mcp },
    hooks: { ...user.hooks, ...project.hooks },
    plugins: { ...user.plugins, ...project.plugins },
    agents: mergeById(user.agents, project.agents),
    userMcpServers: mergeById(user.userMcpServers, project.userMcpServers),
    userHooks: mergeById(user.userHooks, project.userHooks),
  };
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of a) map.set(item.id, item);
  for (const item of b) map.set(item.id, item);
  return [...map.values()];
}

export function saveUserExtensionPreferences(
  prefs: ExtensionPreferences
): void {
  ensureUserExtensionDirs();
  writeFileSync(
    getUserExtensionsPath(),
    JSON.stringify(sanitizePreferences(prefs), null, 2),
    "utf8"
  );
}

export function saveProjectExtensionPreferences(
  cwd: string,
  prefs: ExtensionPreferences
): void {
  const dir = projectSpokDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    projectExtensionsPath(cwd),
    JSON.stringify(sanitizePreferences(prefs), null, 2),
    "utf8"
  );
}

/**
 * Apply a partial patch onto existing prefs.
 * Only fields present on `patch` are merged; list fields are replaced only
 * when the caller explicitly includes them (use `listFields` / raw object).
 */
export function patchPreferences(
  current: ExtensionPreferences,
  patch: Partial<ExtensionPreferences> & Record<string, unknown>
): ExtensionPreferences {
  const has = (key: string) =>
    Object.prototype.hasOwnProperty.call(patch, key);

  return sanitizePreferences({
    version: 1,
    skills: { ...current.skills, ...(patch.skills ?? {}) },
    mcp: { ...current.mcp, ...(patch.mcp ?? {}) },
    hooks: { ...current.hooks, ...(patch.hooks ?? {}) },
    plugins: { ...current.plugins, ...(patch.plugins ?? {}) },
    agents: has("agents") ? patch.agents : current.agents,
    userMcpServers: has("userMcpServers")
      ? patch.userMcpServers
      : current.userMcpServers,
    userHooks: has("userHooks") ? patch.userHooks : current.userHooks,
  });
}

/** Partial sanitize that preserves only provided top-level keys. */
export function sanitizePartialPreferences(
  input: unknown
): Partial<ExtensionPreferences> & Record<string, unknown> {
  if (!isObject(input)) return {};
  const full = sanitizePreferences(input);
  const out: Partial<ExtensionPreferences> & Record<string, unknown> = {};
  if ("skills" in input) out.skills = full.skills;
  if ("mcp" in input) out.mcp = full.mcp;
  if ("hooks" in input) out.hooks = full.hooks;
  if ("plugins" in input) out.plugins = full.plugins;
  if ("agents" in input) out.agents = full.agents;
  if ("userMcpServers" in input) out.userMcpServers = full.userMcpServers;
  if ("userHooks" in input) out.userHooks = full.userHooks;
  return out;
}

export function preferencesLayerPath(
  layer: "user" | "project",
  cwd?: string
): string {
  if (layer === "project") {
    if (!cwd) throw new Error("cwd required for project extensions");
    return projectExtensionsPath(cwd);
  }
  return getUserExtensionsPath();
}
