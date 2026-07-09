import path from "path";
import { existsSync, mkdirSync } from "fs";
import { ensureSpokHome, getSpokHome } from "@/lib/spok-paths";

export function getUserSkillsRoot(): string {
  return path.join(getSpokHome(), "skills");
}

export function getUserPluginsRoot(): string {
  return path.join(getSpokHome(), "plugins");
}

export function getUserExtensionsPath(): string {
  return path.join(getSpokHome(), "extensions.json");
}

export function ensureUserExtensionDirs(): {
  home: string;
  skills: string;
  plugins: string;
} {
  const home = ensureSpokHome();
  const skills = getUserSkillsRoot();
  const plugins = getUserPluginsRoot();
  for (const d of [skills, plugins]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return { home, skills, plugins };
}

export function projectAgentsSkillsDir(cwd: string): string {
  return path.join(path.resolve(cwd), ".agents", "skills");
}

export function projectSpokDir(cwd: string): string {
  return path.join(path.resolve(cwd), ".spok");
}

export function projectPluginsDir(cwd: string): string {
  return path.join(projectSpokDir(cwd), "plugins");
}

export function projectExtensionsPath(cwd: string): string {
  return path.join(projectSpokDir(cwd), "extensions.json");
}

export function projectMcpPath(cwd: string): string {
  return path.join(projectSpokDir(cwd), "mcp.json");
}

export function projectHooksPath(cwd: string): string {
  return path.join(projectSpokDir(cwd), "hooks.json");
}

export function projectAgentsPath(cwd: string): string {
  return path.join(projectSpokDir(cwd), "agents.json");
}
