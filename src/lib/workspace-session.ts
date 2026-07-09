"use client";

import { useSpokStore } from "@/lib/store";
import { trustWorkspace } from "@/lib/local-api-client";
import { saveRecentDir } from "@/components/shell/directory-navigator";

const LAST_CWD_KEY = "spok.lastCwd";
const LAST_CMD_KEY = "spok.lastCommand";

export type OpenWorkspaceOpts = {
  cwd: string;
  command?: string;
  /** Optional display name; defaults to folder basename. */
  name?: string;
};

/**
 * Trust a directory and open a fresh live session pointed at it.
 * Used by Launch dialog, "New session", and command palette.
 */
export async function openWorkspaceSession(
  opts: OpenWorkspaceOpts
): Promise<{ sessionId: string; root: string; name: string }> {
  const cwd = opts.cwd.trim();
  if (!cwd) throw new Error("Working directory is required");

  const trusted = await trustWorkspace(cwd);
  const root = trusted.root;
  const command = (opts.command?.trim() || "grok").trim() || "grok";

  saveRecentDir(root);
  try {
    localStorage.setItem(LAST_CWD_KEY, root);
    localStorage.setItem(LAST_CMD_KEY, command);
  } catch {
    /* ignore */
  }

  const base =
    opts.name?.trim() ||
    root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ||
    "repo";

  // Distinguish multiple sessions in the same repo
  const stamp = new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const name = opts.name?.trim() ? opts.name.trim() : `${base} · ${stamp}`;

  const store = useSpokStore.getState();
  const sessionId = store.createSession({
    name,
    source: "live",
    status: "ready",
    config: {
      cwd: root,
      command,
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
  });

  store.applyStreamEvent(sessionId, {
    type: "system",
    timestamp: Date.now(),
    title: "Workspace ready",
    content: `Repo: ${root}\nCLI: ${command}\nTrusted: yes\nDurable: yes (events saved under ~/.spok/sessions)\n\nType a prompt below, or / for Grok commands.`,
    status: "success",
    provider: "spok",
  });

  store.persistSessionNow(sessionId);
  store.setViewMode("workspace");

  return { sessionId, root, name };
}

/**
 * Resolve the best cwd/command for "new session in same workspace".
 * Prefers the active session, then the most recently updated session with a cwd.
 */
export function resolveCurrentWorkspace(): {
  cwd: string;
  command: string;
} | null {
  const { sessions, activeSessionId } = useSpokStore.getState();
  const active = activeSessionId ? sessions[activeSessionId] : null;
  if (active?.config.cwd?.trim()) {
    return {
      cwd: active.config.cwd,
      command: active.config.command || "grok",
    };
  }

  const recent = Object.values(sessions)
    .filter((s) => s.config.cwd?.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (recent?.config.cwd?.trim()) {
    return {
      cwd: recent.config.cwd,
      command: recent.config.command || "grok",
    };
  }

  try {
    const last = localStorage.getItem(LAST_CWD_KEY);
    if (last?.trim()) {
      return {
        cwd: last,
        command: localStorage.getItem(LAST_CMD_KEY) || "grok",
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}
