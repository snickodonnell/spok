/**
 * Desktop shell bridge (Phase 6).
 * Detects Tauri, native folder picker, OS notifications, and app metadata.
 * Gracefully no-ops in pure browser / Next dev without the desktop shell.
 */

export type DesktopAppInfo = {
  name: string;
  version: string;
  tauriVersion?: string;
  platform: string;
  arch?: string;
  family?: string;
  osVersion?: string;
  identifier?: string;
};

export function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri 2 injects __TAURI_INTERNALS__
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    isTauri?: boolean;
  };
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri);
}

async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  // Dynamic import so browser bundles never require @tauri-apps/api at build time
  // when the package is absent; we also support the global IPC path.
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<T>(cmd, args);
  } catch {
    // Fallback: global invoke if API package path differs
    const w = window as unknown as {
      __TAURI__?: { core?: { invoke?: (c: string, a?: unknown) => Promise<T> } };
    };
    if (w.__TAURI__?.core?.invoke) {
      return w.__TAURI__.core.invoke(cmd, args);
    }
    throw new Error("Tauri invoke unavailable");
  }
}

/** Open the OS native folder picker. Returns absolute path or null if cancelled. */
export async function pickFolderNative(opts?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  try {
    const path = await tauriInvoke<string | null>("pick_folder", {
      title: opts?.title ?? "Open workspace folder",
      defaultPath: opts?.defaultPath ?? null,
    });
    return path ?? null;
  } catch (e) {
    console.warn("[spok] native folder picker failed", e);
    return null;
  }
}

/** OS notification (desktop only). Returns false if unavailable. */
export async function showOsNotification(opts: {
  title: string;
  body: string;
}): Promise<boolean> {
  if (!isDesktopRuntime()) {
    // Browser Notification API fallback when permitted
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(opts.title, { body: opts.body });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    await tauriInvoke("show_notification", {
      title: opts.title,
      body: opts.body,
    });
    return true;
  } catch (e) {
    console.warn("[spok] OS notification failed", e);
    return false;
  }
}

export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  if (!isDesktopRuntime()) {
    return {
      name: "Spok",
      version: "0.1.0",
      platform: typeof navigator !== "undefined" ? navigator.platform : "web",
    };
  }
  try {
    return await tauriInvoke<DesktopAppInfo>("get_app_info");
  } catch {
    return {
      name: "Spok",
      version: "0.1.0",
      platform: "desktop",
    };
  }
}

/** Reveal a path in the OS file manager when possible. */
export async function revealInFileManager(path: string): Promise<boolean> {
  if (!isDesktopRuntime() || !path) return false;
  try {
    await tauriInvoke("reveal_path", { path });
    return true;
  } catch {
    return false;
  }
}

/** Open a path with the default OS handler (docs, URLs, files). */
export async function openExternal(pathOrUrl: string): Promise<boolean> {
  if (!pathOrUrl) return false;
  if (!isDesktopRuntime()) {
    try {
      window.open(pathOrUrl, "_blank", "noopener,noreferrer");
      return true;
    } catch {
      return false;
    }
  }
  try {
    await tauriInvoke("open_path", { path: pathOrUrl });
    return true;
  } catch {
    return false;
  }
}
