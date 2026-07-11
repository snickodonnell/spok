"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSpokStore } from "@/lib/store";
import {
  listDurableSessions,
  registerDurableSession,
} from "@/lib/session-persist-client";
import {
  materializeDurableSessionOnce,
  metaShellSession,
} from "@/lib/session-hydrate";
import { trustWorkspace } from "@/lib/local-api-client";
import { fetchSettings } from "@/lib/settings-client";
import type { Session, SessionMetaRecord } from "@/lib/types";

const LAST_ACTIVE_KEY = "spok.lastActiveSessionId";

export type SessionHydrationOptions = {
  /**
   * Cap how many sessions to put in the sidebar (phone defaults lower).
   */
  maxSessions?: number;
  /**
   * Prefer snapshot over full event replay (default true).
   * Kept for API compat; restore is always snapshot-first now.
   */
  preferSnapshot?: boolean;
};

/**
 * Progressive boot restore:
 * 1. List metas (cheap — meta.json only).
 * 2. Shell entries in sidebar immediately.
 * 3. Fully materialize ONLY the active session (snapshot-first).
 * 4. Unblock UI (hydrated=true).
 * 5. Background-fill other sessions from snapshots without events.ndjson.
 * 6. Trust cwds once per unique path after UI is up.
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
    // Short deadline — progressive restore should finish active session fast.
    const bootDeadline = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[spok] hydration deadline — showing UI anyway");
      setHydrated(true);
      setHydrating(false);
    }, 4_000);

    (async () => {
      setHydrating(true);
      const trustedCwds = new Set<string>();
      try {
        let maxRestore = opts.maxSessions ?? 12;

        // Settings + session list in parallel
        const settingsP = fetchSettings().catch(() => null);
        const metasP = listDurableSessions().catch((e) => {
          console.warn("[spok] list sessions failed (LAN?)", e);
          return [] as SessionMetaRecord[];
        });

        const [settings, metas] = await Promise.all([settingsP, metasP]);
        if (cancelled) return;

        if (settings) {
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
            maxRestore = settings.resolved.maxRestoredSessions ?? 12;
          }
        }

        maxRestore = Math.min(maxRestore, opts.maxSessions ?? maxRestore);
        // Hard cap — never block boot on dozens of heavy sessions
        maxRestore = Math.max(1, Math.min(24, maxRestore));

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

        const toLoad = metas.slice(0, maxRestore);
        const activeMeta =
          toLoad.find((m) => m.id === lastActive) ?? toLoad[0] ?? null;

        // 1) Sidebar shells immediately (no body IO)
        for (const meta of toLoad) {
          if (cancelled) return;
          hydrateSession(metaShellSession(meta), { activate: false });
        }

        // 2) Fully materialize active session only (blocks "Restoring…")
        if (activeMeta) {
          try {
            const session = await materializeDurableSessionOnce(
              activeMeta,
              "full"
            );
            if (cancelled) return;
            hydrateSession(session, { activate: true });
            useSpokStore.getState().setActiveSession(session.id);
            setViewMode("workspace");

            // Trust active cwd ASAP so git/spawn work
            if (session.config.cwd && !trustedCwds.has(session.config.cwd)) {
              trustedCwds.add(session.config.cwd);
              void trustWorkspace(session.config.cwd).catch(() => undefined);
            }
          } catch (e) {
            console.warn(
              "[spok] failed to restore active session",
              activeMeta.id,
              e
            );
            // Still activate shell so user isn't stuck on splash
            useSpokStore.getState().setActiveSession(activeMeta.id);
            setViewMode("workspace");
          }
        }

        // 3) Unblock UI NOW — remaining work is background
        window.clearTimeout(bootDeadline);
        if (!cancelled) {
          setHydrated(true);
          setHydrating(false);
          toast.message(
            toLoad.length === 1
              ? "Restored session"
              : `Restored ${toLoad.length} sessions`
          );
        }

        // 4) Background: snapshot-fill other sessions (skip events.ndjson)
        const rest = toLoad.filter((m) => m.id !== activeMeta?.id);
        for (const meta of rest) {
          if (cancelled) return;
          try {
            // Yield to paint / input between sessions
            await new Promise<void>((r) => {
              if (typeof requestIdleCallback === "function") {
                requestIdleCallback(() => r(), { timeout: 400 });
              } else {
                setTimeout(r, 0);
              }
            });
            if (cancelled) return;

            // Don't clobber if user already opened this session fully
            const existing = useSpokStore.getState().sessions[meta.id];
            if (existing && !existing.hydratePartial) continue;

            const session = await materializeDurableSessionOnce(
              meta,
              "snapshot"
            );
            if (cancelled) return;
            if (session.hydratePartial) continue; // still no body; leave shell

            hydrateSession(session, { activate: false });

            if (session.config.cwd && !trustedCwds.has(session.config.cwd)) {
              trustedCwds.add(session.config.cwd);
              void trustWorkspace(session.config.cwd).catch(() => undefined);
            }
          } catch (e) {
            console.warn("[spok] background restore failed", meta.id, e);
          }
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
      if (
        state.activeSessionId &&
        state.activeSessionId !== prev.activeSessionId
      ) {
        try {
          localStorage.setItem(LAST_ACTIVE_KEY, state.activeSessionId);
        } catch {
          /* ignore */
        }
      }
    });
    return unsub;
  }, []);

  // Lazy full materialize when user activates a partial shell
  useEffect(() => {
    const unsub = useSpokStore.subscribe((state, prev) => {
      const id = state.activeSessionId;
      if (!id || id === prev.activeSessionId) return;
      const sess = state.sessions[id];
      if (!sess?.hydratePartial) return;

      void (async () => {
        try {
          const meta: SessionMetaRecord = {
            id: sess.id,
            name: sess.name,
            status: sess.status,
            createdAt: sess.createdAt,
            updatedAt: sess.updatedAt,
            source: sess.source,
            cwd: sess.config.cwd,
            command: sess.config.command,
            grokFlags: sess.grokFlags,
            formatVersion: 1,
            eventCount: sess.eventCount ?? 0,
            rawCount: 0,
          };
          const full = await materializeDurableSessionOnce(meta, "full");
          // Only apply if still the active target / still partial
          const cur = useSpokStore.getState().sessions[id];
          if (!cur) return;
          if (!cur.hydratePartial && Object.keys(cur.nodes).length > 0) return;
          useSpokStore.getState().hydrateSession(full, {
            activate: useSpokStore.getState().activeSessionId === id,
          });
          if (full.config.cwd) {
            void trustWorkspace(full.config.cwd).catch(() => undefined);
          }
        } catch (e) {
          console.warn("[spok] lazy materialize failed", id, e);
        }
      })();
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
