import path from "path";
import os from "os";
import { existsSync, mkdirSync } from "fs";

/**
 * Shared Spok data-directory helpers (Windows-safe).
 * Prefer SPOK_HOME; sessions may also use SPOK_SESSIONS_DIR.
 */
export function getSpokHome(): string {
  if (process.env.SPOK_HOME?.trim()) {
    return path.resolve(process.env.SPOK_HOME.trim());
  }
  return path.join(os.homedir(), ".spok");
}

export function ensureSpokHome(): string {
  const home = getSpokHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }
  return home;
}

export function getSessionsRoot(): string {
  if (process.env.SPOK_SESSIONS_DIR?.trim()) {
    return path.resolve(process.env.SPOK_SESSIONS_DIR.trim());
  }
  return path.join(getSpokHome(), "sessions");
}

export function ensureSessionsRoot(): string {
  const root = getSessionsRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}
