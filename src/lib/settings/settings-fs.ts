import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import path from "path";
import { mergeLayeredSettings, sanitizePartialSettings } from "./merge";
import { defaultSettings } from "./defaults";
import type { LayeredSettingsBundle, SpokSettings } from "./types";
import { ensureSpokHome, getSpokHome } from "@/lib/spok-paths";
import { setAuditEnabled } from "@/lib/security/audit";

export { getSpokHome };

function ensureHome(): string {
  return ensureSpokHome();
}

function userSettingsPath(): string {
  return path.join(ensureHome(), "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return path.join(cwd, ".spok", "settings.json");
}

function atomicWrite(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function readPartial(file: string): Partial<SpokSettings> {
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return sanitizePartialSettings(raw);
  } catch {
    return {};
  }
}

/** Managed layer from environment (enterprise / CI). */
export function loadManagedSettings(): Partial<SpokSettings> {
  const partial: Partial<SpokSettings> = {};

  const mode = process.env.SPOK_PERMISSION_MODE?.trim();
  if (
    mode &&
    ["manual", "plan", "acceptEdits", "auto", "bypass"].includes(mode)
  ) {
    partial.permissionMode = mode as SpokSettings["permissionMode"];
  }

  if (process.env.SPOK_ALLOW_CUSTOM_COMMANDS === "1") {
    partial.allowCustomCommands = true;
  } else if (process.env.SPOK_ALLOW_CUSTOM_COMMANDS === "0") {
    partial.allowCustomCommands = false;
  }

  const file = process.env.SPOK_MANAGED_SETTINGS?.trim();
  if (file && existsSync(file)) {
    const fromFile = readPartial(file);
    return { ...fromFile, ...partial };
  }

  return partial;
}

export function loadUserSettings(): Partial<SpokSettings> {
  return readPartial(userSettingsPath());
}

export function saveUserSettings(partial: Partial<SpokSettings>): SpokSettings {
  const prev = loadUserSettings();
  const next = sanitizePartialSettings({ ...prev, ...partial, version: 1 });
  atomicWrite(userSettingsPath(), next);
  return deepResolved(undefined);
}

export function loadProjectSettings(cwd?: string | null): Partial<SpokSettings> {
  if (!cwd?.trim()) return {};
  try {
    const file = projectSettingsPath(path.resolve(cwd));
    return readPartial(file);
  } catch {
    return {};
  }
}

export function saveProjectSettings(
  cwd: string,
  partial: Partial<SpokSettings>
): void {
  const file = projectSettingsPath(path.resolve(cwd));
  const prev = readPartial(file);
  const next = sanitizePartialSettings({ ...prev, ...partial, version: 1 });
  atomicWrite(file, next);
}

export function resolveSettings(opts?: {
  cwd?: string | null;
  local?: Partial<SpokSettings>;
}): LayeredSettingsBundle {
  return mergeLayeredSettings({
    managed: loadManagedSettings(),
    user: loadUserSettings(),
    project: loadProjectSettings(opts?.cwd),
    local: opts?.local ?? {},
  });
}

function deepResolved(cwd?: string | null): SpokSettings {
  return resolveSettings({ cwd }).resolved;
}

export function getResolvedSettings(cwd?: string | null): SpokSettings {
  const resolved = deepResolved(cwd);
  // Keep disk audit logging aligned with settings
  setAuditEnabled(resolved.auditPrivilegedActions !== false);
  return resolved;
}

export function resetUserSettings(): SpokSettings {
  const file = userSettingsPath();
  if (existsSync(file)) {
    try {
      rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
  return defaultSettings();
}
