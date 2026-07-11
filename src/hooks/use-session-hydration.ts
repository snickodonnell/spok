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
import { writeCachedUiPrefs } from "@/lib/ui-prefs-cache";
import { startMark } from "@/lib/perf";
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
 * Progressive boot restore (optimized for perceived launch speed):
 * 1. UI theme already applied from localStorage (layout boot script + store seed).
 * 2. List metas + settings in parallel (settings do not gate session shells).
 * 3. Shell entries + activate last session immediately → unblock UI.
 * 4. Materialize active session body in background (no splash wait).
 * 5. Background-fill other sessions from lean snapshots.
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
  const setAutomationMaxConcurrent = useSpokStore(
    (s) => s.setAutomationMaxConcurrent
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    let uiUnblocked = false;
    const bootMark = startMark("app_boot");

    // Short deadline — UI must not stay on "Restoring…" even if disk is slow.
    const bootDeadline = window.setTimeout(() => {
      if (cancelled || uiUnblocked) return;
      console.warn("[spok] hydration deadline — showing UI anyway");
      uiUnblocked = true;
      setHydrated(true);
      setHydrating(false);
      bootMark.end({ reason: "deadline" });
    }, 2_500);

    const applySettingsBundle = (settings: Awaited<
      ReturnType<typeof fetchSettings>
    >) => {
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
      setAutomationMaxConcurrent(settings.resolved.maxConcurrentBackground);
      writeCachedUiPrefs({
        theme: ui.theme ?? "professional",
        crtEnabled: !!ui.crtEnabled,
        scanlines: !!ui.scanlines,
        reducedMotion: !!ui.reducedMotion,
        permissionMode: settings.resolved.permissionMode,
        osNotifications:
          ui.osNotifications ?? desktop?.osNotifications ?? true,
        nativeFolderPicker: desktop?.nativeFolderPicker ?? true,
      });
    };

    const unblockUi = () => {
      window.clearTimeout(bootDeadline);
      if (cancelled || uiUnblocked) return;
      uiUnblocked = true;
      setHydrated(true);
      setHydrating(false);
      bootMark.end({ reason: "shells_ready" });
    };

    (async () => {
      setHydrating(true);
      const trustedCwds = new Set<string>();
      try {
        let maxRestore = opts.maxSessions ?? 12;

        // Fire settings + metas independently — never block shells on settings.
        const settingsP = fetchSettings()
          .then((s) => {
            if (cancelled) return null;
            applySettingsBundle(s);
            if (opts.maxSessions == null) {
              maxRestore = Math.min(
                maxRestore,
                s.resolved.maxRestoredSessions ?? maxRestore
              );
            }
            return s;
          })
          .catch(() => null);

        const metasP = listDurableSessions().catch((e) => {
          console.warn("[spok] list sessions failed (LAN?)", e);
          return [] as SessionMetaRecord[];
        });

        // Prefer metas first for shells; settings can land whenever.
        const metas = await metasP;
        if (cancelled) return;

        // If settings already resolved, pick up maxRestore; else don't wait.
        void settingsP;

        maxRestore = Math.min(maxRestore, opts.maxSessions ?? maxRestore);
        maxRestore = Math.max(1, Math.min(24, maxRestore));

        if (metas.length === 0) {
          await settingsP.catch(() => null);
          unblockUi();
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

        // 2) Activate last session shell NOW — leave splash, load body async
        if (activeMeta) {
          useSpokStore.getState().setActiveSession(activeMeta.id);
          setViewMode("workspace");
        }

        // 3) Unblock UI before any multi-MB snapshot parse
        unblockUi();
        if (!cancelled && toLoad.length > 0) {
          // Defer toast so it doesn't fight first paint
          window.setTimeout(() => {
            if (cancelled) return;
            toast.message(
              toLoad.length === 1
                ? "Restored session"
                : `Restored ${toLoad.length} sessions`
            );
          }, 400);
        }

        // 4) Materialize active session body (snapshot-first, background)
        if (activeMeta) {
          try {
            const session = await materializeDurableSessionOnce(
              activeMeta,
              "full"
            );
            if (cancelled) return;
            // Don't clobber if user already navigated away
            const still =
              useSpokStore.getState().activeSessionId === activeMeta.id ||
              useSpokStore.getState().sessions[activeMeta.id]?.hydratePartial;
            if (still) {
              hydrateSession(session, {
                activate:
                  useSpokStore.getState().activeSessionId === activeMeta.id,
              });
            }
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
          }
        }

        // Ensure settings finished (for maxRestore / late apply)
        await settingsP.catch(() => null);

        // 5) Background: lean snapshot-fill other sessions
        const rest = toLoad.filter((m) => m.id !== activeMeta?.id);
        for (const meta of rest) {
          if (cancelled) return;
          try {
            await new Promise<void>((r) => {
              if (typeof requestIdleCallback === "function") {
                requestIdleCallback(() => r(), { timeout: 600 });
              } else {
                setTimeout(r, 16);
              }
            });
            if (cancelled) return;

            const existing = useSpokStore.getState().sessions[meta.id];
            if (existing && !existing.hydratePartial) continue;

            const session = await materializeDurableSessionOnce(
              meta,
              "snapshot"
            );
            if (cancelled) return;
            if (session.hydratePartial) continue;

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
    setAutomationMaxConcurrent,
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
