import type { ExtensionsBundle, SkillDescriptor } from "./types";
import {
  getUserExtensionsPath,
  getUserPluginsRoot,
  getUserSkillsRoot,
  projectAgentsSkillsDir,
  projectSpokDir,
} from "./paths";
import {
  discoverProjectSkills,
  discoverUserSkills,
} from "./skills";
import {
  loadProjectMcpServers,
  listMcpToolsReadOnly,
  mergeMcpServers,
  redactMcpEnvForDisplay,
} from "./mcp";
import {
  builtinHooks,
  loadProjectHooks,
  mergeHooks,
} from "./hooks";
import {
  discoverAllPlugins,
  expandPluginContributions,
} from "./plugins";
import {
  builtinAgents,
  loadProjectAgents,
  mergeAgents,
} from "./agents";
import {
  loadProjectExtensionPreferences,
  loadUserExtensionPreferences,
  mergeExtensionPreferences,
} from "./preferences";
import { getResolvedSettings } from "@/lib/settings/settings-fs";

/** Discover the full extensions bundle for a workspace cwd. */
export function discoverExtensions(cwd?: string): ExtensionsBundle {
  const userPrefs = loadUserExtensionPreferences();
  const projectPrefs = loadProjectExtensionPreferences(cwd);
  const preferences = mergeExtensionPreferences(userPrefs, projectPrefs);

  const plugins = discoverAllPlugins(cwd, preferences);
  const pluginBits = expandPluginContributions(plugins, preferences);

  const projectSkills = discoverProjectSkills(cwd, preferences.skills);
  const userSkills = discoverUserSkills(preferences.skills);

  // Dedupe skills by id (project > user > plugin)
  const skillMap = new Map<string, SkillDescriptor>();
  for (const s of [
    ...pluginBits.skills,
    ...userSkills,
    ...projectSkills,
  ]) {
    skillMap.set(s.id, s);
  }
  // Apply enable map again (plugin discovery may have missed later prefs)
  for (const s of skillMap.values()) {
    if (s.id in preferences.skills) {
      s.enabled = preferences.skills[s.id] !== false;
    }
  }
  const skills = [...skillMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const mcpServers = mergeMcpServers({
    user: [],
    project: loadProjectMcpServers(cwd),
    plugin: pluginBits.mcp,
    prefs: preferences,
  }).map((s) => ({
    ...s,
    env: redactMcpEnvForDisplay(s.env),
  }));

  const settings = getResolvedSettings(cwd);
  const mcpTools = listMcpToolsReadOnly(mcpServers, settings);

  const hooks = mergeHooks({
    builtin: builtinHooks(),
    user: [],
    project: loadProjectHooks(cwd),
    plugin: pluginBits.hooks,
    prefs: preferences,
  });

  const agents = mergeAgents({
    builtin: builtinAgents(),
    project: loadProjectAgents(cwd),
    plugin: pluginBits.agents,
    prefs: preferences,
  });

  return {
    skills,
    mcpServers,
    mcpTools,
    hooks,
    plugins,
    agents,
    preferences,
    roots: {
      projectAgents: cwd ? projectAgentsSkillsDir(cwd) : undefined,
      projectSpok: cwd ? projectSpokDir(cwd) : undefined,
      userSkills: getUserSkillsRoot(),
      userPlugins: getUserPluginsRoot(),
      userExtensions: getUserExtensionsPath(),
    },
  };
}
