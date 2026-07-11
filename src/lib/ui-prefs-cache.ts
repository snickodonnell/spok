/**
 * Instant UI prefs cache — avoids waiting on /api/settings for theme/CRT.
 * Written whenever the user changes appearance; applied before network boot.
 */

import {
  applyThemeToDocument,
  isUiTheme,
  resolveThemeEffects,
  type UiTheme,
} from "./theme";
import type { AppPermissionMode } from "./settings/types";

export const UI_PREFS_STORAGE_KEY = "spok.uiPrefs";

export type CachedUiPrefs = {
  v: 1;
  theme: UiTheme;
  crtEnabled: boolean;
  scanlines: boolean;
  reducedMotion: boolean;
  permissionMode?: AppPermissionMode;
  osNotifications?: boolean;
  nativeFolderPicker?: boolean;
  /** Unix ms when last written. */
  updatedAt: number;
};

const PERMISSION_MODES = new Set([
  "manual",
  "plan",
  "acceptEdits",
  "auto",
  "bypass",
]);

function isPermissionMode(v: unknown): v is AppPermissionMode {
  return typeof v === "string" && PERMISSION_MODES.has(v);
}

/** Read cached prefs (browser only). Returns null when missing/invalid. */
export function readCachedUiPrefs(): CachedUiPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CachedUiPrefs>;
    if (!isUiTheme(data.theme)) return null;
    return {
      v: 1,
      theme: data.theme,
      crtEnabled: data.crtEnabled === true,
      scanlines: data.scanlines === true,
      reducedMotion: data.reducedMotion === true,
      permissionMode: isPermissionMode(data.permissionMode)
        ? data.permissionMode
        : undefined,
      osNotifications:
        typeof data.osNotifications === "boolean"
          ? data.osNotifications
          : undefined,
      nativeFolderPicker:
        typeof data.nativeFolderPicker === "boolean"
          ? data.nativeFolderPicker
          : undefined,
      updatedAt:
        typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeCachedUiPrefs(
  prefs: Omit<CachedUiPrefs, "v" | "updatedAt"> & { updatedAt?: number }
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedUiPrefs = {
      v: 1,
      theme: prefs.theme,
      crtEnabled: !!prefs.crtEnabled,
      scanlines: !!prefs.scanlines,
      reducedMotion: !!prefs.reducedMotion,
      permissionMode: prefs.permissionMode,
      osNotifications: prefs.osNotifications,
      nativeFolderPicker: prefs.nativeFolderPicker,
      updatedAt: prefs.updatedAt ?? Date.now(),
    };
    window.localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

/** Apply cached theme to <html> immediately (no React required). */
export function applyCachedThemeToDocument(
  prefs: CachedUiPrefs | null = readCachedUiPrefs()
): void {
  if (!prefs || typeof document === "undefined") return;
  const fx = resolveThemeEffects({
    theme: prefs.theme,
    crtEnabled: prefs.crtEnabled,
    scanlines: prefs.scanlines,
    reducedMotion: prefs.reducedMotion,
  });
  applyThemeToDocument(fx);
}

/**
 * Inline boot script source for layout — runs before paint to prevent FOUC.
 * Keep self-contained (no imports).
 */
export const UI_PREFS_BOOT_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(UI_PREFS_STORAGE_KEY)});if(!r)return;var p=JSON.parse(r);if(!p||(p.theme!=="professional"&&p.theme!=="crt"&&p.theme!=="high-contrast"))return;var root=document.documentElement;root.setAttribute("data-theme",p.theme);var reduced=!!p.reducedMotion;var crt=p.theme==="crt"&&!reduced&&p.crtEnabled!==false;var scan=crt&&!reduced&&!!p.scanlines;root.classList.toggle("theme-crt-effects",crt);root.classList.toggle("theme-scanlines",scan);root.classList.toggle("reduce-motion",reduced);root.classList.add("dark");}catch(e){}})();`;
