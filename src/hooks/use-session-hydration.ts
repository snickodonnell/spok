"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

export type SessionHydrationState =
  | { phase: "restoring"; attempt: number; operation: string }
  | { phase: "ready"; attempt: number; restoredCount: number }
  | {
      phase: "recovery";
      attempt: number;
      operation: string;
      message: string;
      timedOut: boolean;
    }
  | { phase: "continued"; attempt: number; operation: string };

export type SessionHydrationController = {
  state: SessionHydrationState;
  retry: () => void;
  continueWithoutRestoredSessions: () => void;
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
export function useSessionHydration(
  opts: SessionHydrationOptions = {}
): SessionHydrationController {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SessionHydrationState>({
    phase: "restoring",
    attempt: 1,
    operation: "List saved sessions",
  });
  const generationRef = useRef(0);
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

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const continueWithoutRestoredSessions = useCallback(() => {
    generationRef.current += 1;
    const nextAttempt = attempt + 1;
    setHydrated(true);
    setHydrating(false);
    setState({
      phase: "continued",
      attempt: nextAttempt,
      operation: "Restore skipped for this launch",
    });
  }, [attempt, setHydrated, setHydrating]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    let uiUnblocked = false;
    let terminalFailure = false;
    const attemptNumber = attempt + 1;
    const bootMark = startMark("app_boot");

    const isCurrent = () =>
      !cancelled && generationRef.current === generation;

    setState({
      phase: "restoring",
      attempt: attemptNumber,
      operation: "List saved sessions",
    });

    // Short deadline — UI must not stay on "Restoring…" even if disk is slow.
    const bootDeadline = window.setTimeout(() => {
      if (!isCurrent() || uiUnblocked) return;
      console.warn("[spok] hydration deadline — showing recovery actions");
      uiUnblocked = true;
      setHydrated(true);
      setHydrating(false);
      bootMark.end({ reason: "deadline" });
      setState({
        phase: "recovery",
        attempt: attemptNumber,
        operation: "List saved sessions",
        message: "The session store did not respond within 2.5 seconds.",
        timedOut: true,
      });
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

    const unblockUi = (restoredCount: number) => {
      window.clearTimeout(bootDeadline);
      if (!isCurrent()) return;
      if (!uiUnblocked) {
        uiUnblocked = true;
        setHydrated(true);
        setHydrating(false);
        bootMark.end({ reason: "shells_ready" });
      }
      setState({ phase: "ready", attempt: attemptNumber, restoredCount });
    };

    (async () => {
      setHydrating(true);
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

        const metasP = listDurableSessions();

        // Prefer metas first for shells; settings can land whenever.
        const metas = await metasP;
        if (!isCurrent()) return;

        // If settings already resolved, pick up maxRestore; else don't wait.
        void settingsP;

        maxRestore = Math.min(maxRestore, opts.maxSessions ?? maxRestore);
        maxRestore = Math.max(1, Math.min(24, maxRestore));

        if (metas.length === 0) {
          await settingsP.catch(() => null);
          unblockUi(0);
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
          if (!isCurrent()) return;
          hydrateSession(metaShellSession(meta), { activate: false });
        }

        // 2) Activate last session shell NOW — leave splash, load body async
        if (activeMeta) {
          useSpokStore.getState().setActiveSession(activeMeta.id);
          setViewMode("workspace");
        }

        // 3) Unblock UI before any multi-MB snapshot parse
        unblockUi(toLoad.length);
        if (isCurrent() && toLoad.length > 0) {
          // Defer toast so it doesn't fight first paint
          window.setTimeout(() => {
            if (!isCurrent()) return;
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
            if (!isCurrent()) return;
            // Don't clobber if user already navigated away
            const still =
              useSpokStore.getState().activeSessionId === activeMeta.id ||
              useSpokStore.getState().sessions[activeMeta.id]?.hydratePartial;
            if (still && session.hydratePartial) {
              useSpokStore.getState().updateSession(activeMeta.id, {
                restoreState: "unavailable",
                restoreError: "Saved session details are unavailable",
              });
            } else if (still) {
              hydrateSession(session, {
                activate:
                  useSpokStore.getState().activeSessionId === activeMeta.id,
              });
            }
          } catch (e) {
            console.warn(
              "[spok] failed to restore active session",
              activeMeta.id,
              e
            );
            if (isCurrent()) {
              useSpokStore.getState().updateSession(activeMeta.id, {
                restoreState: "unavailable",
                restoreError: "Saved session details could not be restored",
              });
            }
          }
        }

        // Ensure settings finished (for maxRestore / late apply)
        await settingsP.catch(() => null);

        // 5) Background: lean snapshot-fill other sessions
        const rest = toLoad.filter((m) => m.id !== activeMeta?.id);
        for (const meta of rest) {
          if (!isCurrent()) return;
          try {
            await new Promise<void>((r) => {
              if (typeof requestIdleCallback === "function") {
                requestIdleCallback(() => r(), { timeout: 600 });
              } else {
                setTimeout(r, 16);
              }
            });
            if (!isCurrent()) return;

            const existing = useSpokStore.getState().sessions[meta.id];
            if (existing && !existing.hydratePartial) continue;

            const session = await materializeDurableSessionOnce(
              meta,
              "snapshot"
            );
            if (!isCurrent()) return;
            if (session.hydratePartial) {
              useSpokStore.getState().updateSession(meta.id, {
                restoreState: "unavailable",
                restoreError: "Saved session details are unavailable",
              });
              continue;
            }

            hydrateSession(session, { activate: false });
          } catch (e) {
            console.warn("[spok] background restore failed", meta.id, e);
            if (isCurrent()) {
              useSpokStore.getState().updateSession(meta.id, {
                restoreState: "unavailable",
                restoreError: "Saved session details could not be restored",
              });
            }
          }
        }

      } catch (e) {
        console.warn("[spok] session hydration failed", e);
        if (isCurrent()) {
          terminalFailure = true;
          const message = e instanceof Error ? e.message : "Unknown restore error";
          uiUnblocked = true;
          setHydrated(true);
          setHydrating(false);
          bootMark.end({ reason: "restore_failed" });
          setState({
            phase: "recovery",
            attempt: attemptNumber,
            operation: "List saved sessions",
            message,
            timedOut: false,
          });
        }
      } finally {
        window.clearTimeout(bootDeadline);
        if (isCurrent() && !terminalFailure && !uiUnblocked) {
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
    attempt,
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
        } catch (e) {
          console.warn("[spok] lazy materialize failed", id, e);
          const current = useSpokStore.getState().sessions[id];
          if (current) {
            useSpokStore.getState().updateSession(id, {
              restoreState: "unavailable",
              restoreError: "Saved session details could not be restored",
            });
          }
        }
      })();
    });
    return unsub;
  }, []);

  return { state, retry, continueWithoutRestoredSessions };
}

/** Ensure a live workspace is registered durably (e.g. after open-repo). */
export async function ensureDurable(session: Session): Promise<void> {
  try {
    await registerDurableSession(session);
  } catch {
    /* already exists or offline */
  }
}
