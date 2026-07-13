/** Client helpers for explicit, scoped session lifecycle actions. */

import {
  getCachedCapabilityToken,
  getCapabilityToken,
} from "./local-api-client";
import { CAPABILITY_HEADER } from "./security/local-api-shared";
import { useSpokStore } from "./store";
import type { Session } from "./types";

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

export type WorkspaceRunConflict = {
  sessionId: string;
  name: string;
  cwd: string;
  status: Session["status"];
};

export function isLiveSession(session: Session): boolean {
  return (
    session.status === "running" ||
    session.status === "starting" ||
    session.status === "paused"
  );
}

/**
 * A genuine repository-open conflict exists only for a live foreground run in
 * the exact same non-isolated checkout. Runs in other repositories/worktrees
 * are unrelated and must never be stopped by context switching.
 */
export function findWorkspaceRunConflict(
  nextCwd: string,
  sessions: Record<string, Session> = useSpokStore.getState().sessions
): WorkspaceRunConflict | null {
  const target = normalizeWorkspacePath(nextCwd);
  const conflict = Object.values(sessions)
    .filter(
      (session) =>
        isLiveSession(session) &&
        !session.backgroundJob &&
        !session.config.worktreePath &&
        normalizeWorkspacePath(session.config.cwd) === target
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return conflict
    ? {
        sessionId: conflict.id,
        name: conflict.name,
        cwd: conflict.config.cwd,
        status: conflict.status,
      }
    : null;
}

/**
 * Stop the Grok harness process for a session on the host.
 * `keepalive` is available for an explicit stop request during navigation, but
 * passive navigation/lifecycle handlers must never call this function.
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

/**
 * Explicit fleet action only. Callers must show a complete impact preview and
 * receive fleet confirmation before invoking this helper.
 */
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
