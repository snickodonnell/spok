"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSpokStore } from "@/lib/store";
import {
  listDurableSessions,
  loadDurableSession,
  registerDurableSession,
} from "@/lib/session-persist-client";
import { replayEvents } from "@/lib/session-replay";
import { trustWorkspace } from "@/lib/local-api-client";
import { fetchSettings } from "@/lib/settings-client";
import type { Session } from "@/lib/types";

const LAST_ACTIVE_KEY = "spok.lastActiveSessionId";

export type SessionHydrationOptions = {
  /**
   * Cap how many sessions to restore (phone defaults lower for Wi‑Fi speed).
   */
  maxSessions?: number;
  /**
   * Prefer snapshot over full event replay when event count is high.
   * Much faster on mobile / LAN.
   */
  preferSnapshot?: boolean;
};

/**
 * On app mount, restore durable sessions from ~/.spok/sessions (via local API).
 * Prefers replaying the append-only event log; falls back to snapshot.
 */
export function useSessionHydration(opts: SessionHydrationOptions = {}) {
  const started = useRef(false);
  const hydrateSession = useSpokStore((s) => s.hydrateSession);
  const setHydrated = useSpokStore((s) => s.setHydrated);
  const setHydrating = useSpokStore((s) => s.setHydrating);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const setAppPermissionMode = useSpokStore((s) => s.setAppPermissionMode);
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const setUiTheme = useSpokStore((s) => s.setUiTheme);
  const setReducedMotion = useSpokStore((s) => s.setReducedMotion);
  const setOsNotifications = useSpokStore((s) => s.setOsNotifications);
  const setNativeFolderPicker = useSpokStore((s) => s.setNativeFolderPicker);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    // Hard deadline so phone never spins forever if LAN is flaky
    const bootDeadline = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[spok] hydration deadline — showing UI anyway");
      setHydrated(true);
      setHydrating(false);
    }, 12_000);

    (async () => {
      setHydrating(true);
      try {
        // Load layered settings early so permission mode is visible
        let maxRestore = opts.maxSessions ?? 20;
        try {
          const settings = await fetchSettings();
          if (!cancelled) {
            const ui = settings.resolved.ui;
            const desktop = settings.resolved.desktop;
            setAppPermissionMode(settings.resolved.permissionMode);
            setUiTheme(ui.theme ?? "professional");
            setCrtEnabled(ui.crtEnabled);
            setScanlines(ui.scanlines);
            setReducedMotion(ui.reducedMotion ?? false);
            setOsNotifications(
              ui.osNotifications ?? desktop?.osNotifications ?? true
            );
            setNativeFolderPicker(desktop?.nativeFolderPicker ?? true);
            if (opts.maxSessions == null) {
              maxRestore = settings.resolved.maxRestoredSessions ?? 20;
            }
          }
        } catch {
          /* settings optional at boot */
        }

        // Phone / LAN: keep boot tiny
        maxRestore = Math.min(maxRestore, opts.maxSessions ?? maxRestore);

        let metas: Awaited<ReturnType<typeof listDurableSessions>> = [];
        try {
          metas = await listDurableSessions();
        } catch (e) {
          console.warn("[spok] list sessions failed (LAN?)", e);
          return;
        }
        if (cancelled) return;

        if (metas.length === 0) {
          setHydrated(true);
          setHydrating(false);
          return;
        }

        let lastActive: string | null = null;
        try {
          lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
        } catch {
          /* ignore */
        }

        // Restore most recent N sessions (keep UI snappy)
        const toLoad = metas.slice(0, Math.max(1, Math.min(100, maxRestore)));
        let restored = 0;
        let activeId: string | null = null;

        for (const meta of toLoad) {
          try {
            const bundle = await loadDurableSession(meta.id);
            if (cancelled) return;

            let session: Session;
            const eventCount = bundle.events.length;
            const useSnapshot =
              opts.preferSnapshot &&
              bundle.snapshot &&
              (eventCount === 0 || eventCount > 200);

            if (useSnapshot && bundle.snapshot) {
              session = {
                ...bundle.snapshot,
                id: meta.id,
                source: "resume",
                status:
                  bundle.snapshot.status === "running" ||
                  bundle.snapshot.status === "starting"
                    ? "ready"
                    : bundle.snapshot.status,
                durable: true,
                // Keep a short tail for thinking UI; full log stays on disk
                eventLog: bundle.events.slice(-80),
                eventCount: eventCount || bundle.snapshot.eventCount,
              };
            } else if (bundle.events.length > 0) {
              session = replayEvents(bundle.events, {
                id: meta.id,
                name: meta.name,
                source: "resume",
                status:
                  meta.status === "running" || meta.status === "starting"
                    ? "ready"
                    : meta.status,
                createdAt: meta.createdAt,
                grokFlags: meta.grokFlags,
                config: {
                  cwd: meta.cwd,
                  command: meta.command || "grok",
                  args: [],
                  autoScroll: true,
                  playbackSpeed: 1,
                },
              });
              session.eventLog = bundle.events;
              session.eventCount = bundle.events.length;
              session.durable = true;
              session.updatedAt = meta.updatedAt;
              // Prefer snapshot prompt history / flags when available
              if (bundle.snapshot?.promptHistory?.length) {
                session.promptHistory = bundle.snapshot.promptHistory;
              }
              if (bundle.snapshot?.grokFlags) {
                session.grokFlags = bundle.snapshot.grokFlags;
              }
              if (bundle.snapshot?.rawLog?.length && !session.rawLog.length) {
                session.rawLog = bundle.snapshot.rawLog;
              }
            } else if (bundle.snapshot) {
              session = {
                ...bundle.snapshot,
                id: meta.id,
                source: "resume",
                status:
                  bundle.snapshot.status === "running" ||
                  bundle.snapshot.status === "starting"
                    ? "ready"
                    : bundle.snapshot.status,
                durable: true,
                eventLog: bundle.snapshot.eventLog ?? [],
              };
            } else {
              // Meta-only empty workspace
              session = {
                id: meta.id,
                name: meta.name,
                status: "ready",
                createdAt: meta.createdAt,
                updatedAt: meta.updatedAt,
                config: {
                  cwd: meta.cwd,
                  command: meta.command || "grok",
                  args: [],
                  autoScroll: true,
                  playbackSpeed: 1,
                },
                metrics: {
                  startedAt: null,
                  endedAt: null,
                  elapsedMs: 0,
                  toolCallCount: 0,
                  thinkingSteps: 0,
                  filesChanged: 0,
                  linesAdded: 0,
                  linesDeleted: 0,
                  subagentCount: 0,
                  errorCount: 0,
                },
                rootTraceIds: [],
                nodes: {},
                files: {},
                fileTree: [],
                selectedTraceId: null,
                selectedFileId: null,
                timelineCursor: null,
                rawLog: [],
                source: "resume",
                promptHistory: [],
                grokFlags: meta.grokFlags,
                eventLog: [],
                durable: true,
                eventCount: 0,
              };
            }

            // Re-trust workspace root so git/spawn work after restart
            if (session.config.cwd) {
              try {
                await trustWorkspace(session.config.cwd);
              } catch {
                /* user can re-open repo if trust fails */
              }
            }

            const activate =
              meta.id === lastActive ||
              (!lastActive && restored === 0 && toLoad[0]?.id === meta.id);
            hydrateSession(session, { activate: false });
            if (activate) activeId = session.id;
            restored += 1;
          } catch (e) {
            console.warn("[spok] failed to restore session", meta.id, e);
          }
        }

        if (activeId) {
          useSpokStore.getState().setActiveSession(activeId);
          setViewMode("workspace");
        }

        if (restored > 0) {
          toast.message(
            restored === 1
              ? "Restored 1 session from disk"
              : `Restored ${restored} sessions from disk`
          );
        }
      } catch (e) {
        console.warn("[spok] session hydration failed", e);
      } finally {
        window.clearTimeout(bootDeadline);
        if (!cancelled) {
          setHydrated(true);
          setHydrating(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(bootDeadline);
    };
  }, [
    hydrateSession,
    setHydrated,
    setHydrating,
    setViewMode,
    setAppPermissionMode,
    setCrtEnabled,
    setScanlines,
    setUiTheme,
    setReducedMotion,
    setOsNotifications,
    setNativeFolderPicker,
    opts.maxSessions,
    opts.preferSnapshot,
  ]);

  // Remember last active session for next launch
  useEffect(() => {
    const unsub = useSpokStore.subscribe((state, prev) => {
      if (state.activeSessionId && state.activeSessionId !== prev.activeSessionId) {
        try {
          localStorage.setItem(LAST_ACTIVE_KEY, state.activeSessionId);
        } catch {
          /* ignore */
        }
      }
    });
    return unsub;
  }, []);
}

/** Ensure a live workspace is registered durably (e.g. after open-repo). */
export async function ensureDurable(session: Session): Promise<void> {
  try {
    await registerDurableSession(session);
  } catch {
    /* already exists or offline */
  }
}
