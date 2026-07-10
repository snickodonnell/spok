/**
 * Client helpers for session start/stop lifecycle (mobile abandon + cwd change).
 */

import {
  getCachedCapabilityToken,
  getCapabilityToken,
  localFetch,
} from "./local-api-client";
import { CAPABILITY_HEADER } from "./security/local-api-shared";
import { useSpokStore } from "./store";

/** Normalize paths for equality (Windows drive letters, slashes). */
export function normalizeWorkspacePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function isDifferentWorkspace(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  if (!a?.trim() || !b?.trim()) return true;
  return normalizeWorkspacePath(a) !== normalizeWorkspacePath(b);
}

/**
 * Stop the Grok harness process for a session on the host.
 * Uses keepalive fetch so it can run during pagehide on mobile.
 */
export async function stopHarnessProcess(
  sessionId: string,
  opts?: { keepalive?: boolean; updateStore?: boolean }
): Promise<void> {
  const keepalive = opts?.keepalive === true;
  const updateStore = opts?.updateStore !== false;

  try {
    let token = getCachedCapabilityToken();
    if (!token && !keepalive) {
      token = await getCapabilityToken();
    }
    if (!token) {
      // Last chance for keepalive path
      try {
        token = await getCapabilityToken();
      } catch {
        /* abandon silently */
      }
    }
    if (token) {
      const headers: Record<string, string> = {
        [CAPABILITY_HEADER]: token,
      };
      await fetch(
        `/api/session/start?sessionId=${encodeURIComponent(sessionId)}`,
        {
          method: "DELETE",
          headers,
          keepalive,
          cache: "no-store",
        }
      );
    }
  } catch {
    /* best-effort on unload */
  }

  if (updateStore) {
    const session = useSpokStore.getState().sessions[sessionId];
    if (
      session &&
      (session.status === "running" ||
        session.status === "starting" ||
        session.status === "paused")
    ) {
      useSpokStore.getState().updateSession(sessionId, {
        status: "stopped",
      });
    }
  }
}

/** Stop active session process if it looks live. */
export async function stopActiveHarnessIfLive(opts?: {
  keepalive?: boolean;
}): Promise<string | null> {
  const { activeSessionId, sessions } = useSpokStore.getState();
  if (!activeSessionId) return null;
  const s = sessions[activeSessionId];
  if (!s) return null;
  if (
    s.status === "running" ||
    s.status === "starting" ||
    s.status === "paused"
  ) {
    await stopHarnessProcess(activeSessionId, {
      keepalive: opts?.keepalive,
    });
    return activeSessionId;
  }
  return null;
}

/** Stop every session that still looks live (not only the active one). */
export async function stopAllLiveHarnesses(opts?: {
  keepalive?: boolean;
}): Promise<number> {
  const sessions = Object.values(useSpokStore.getState().sessions);
  let n = 0;
  for (const s of sessions) {
    if (
      s.status === "running" ||
      s.status === "starting" ||
      s.status === "paused"
    ) {
      await stopHarnessProcess(s.id, { keepalive: opts?.keepalive });
      n += 1;
    }
  }
  return n;
}

/**
 * When opening a new workspace directory: always tear down live harnesses
 * so an "active session" never blocks folder changes (mobile requirement).
 */
export async function stopPreviousSessionForWorkspaceChange(
  _nextCwd: string
): Promise<void> {
  // Always clear live processes — user is intentionally changing context
  await stopAllLiveHarnesses();

  const { activeSessionId, sessions } = useSpokStore.getState();
  if (!activeSessionId) return;
  const prev = sessions[activeSessionId];
  if (!prev) return;

  // Mark previous active session stopped even if it was only "ready"
  // so mobile UI never thinks it still owns the host process.
  if (
    prev.status === "running" ||
    prev.status === "starting" ||
    prev.status === "paused" ||
    prev.status === "ready"
  ) {
    // Keep ready sessions ready if they never ran; only force-stop live ones
    // (already handled). Clear error sticky state.
    if (prev.error) {
      useSpokStore.getState().updateSession(activeSessionId, {
        error: undefined,
      });
    }
  }
}
