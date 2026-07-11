"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHostSyncSnapshot,
  pullAndMergeSession,
  type HostSyncSnapshot,
} from "@/lib/host-session-sync";
import type { LiveProcessInfo } from "@/lib/session-persist-client";
import { useSpokStore } from "@/lib/store";
import type { SessionMetaRecord } from "@/lib/types";

const BASE_POLL_MS = 3_000;
const LIVE_POLL_MS = 1_500;

export type HostSessionSync = {
  metas: SessionMetaRecord[];
  liveProcesses: LiveProcessInfo[];
  liveSessionIds: string[];
  activeLive: boolean;
  anyLive: boolean;
  lastRefreshAt: number | null;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Bi-directional host sync for mobile + desktop:
 * - polls live process registry
 * - pulls durable events / snapshot fields (prompts, files, status)
 * so both UIs stay live while the app is open on the same network/server.
 */
export function useHostSessionSync(enabled = true): HostSessionSync {
  const [metas, setMetas] = useState<SessionMetaRecord[]>([]);
  const [liveProcesses, setLiveProcesses] = useState<LiveProcessInfo[]>([]);
  const [liveSessionIds, setLiveSessionIds] = useState<string[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pulledCount = useRef<Record<string, number>>({});
  const inFlight = useRef(false);

  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const activeStatus = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.status : undefined
  );

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const snap: HostSyncSnapshot = await fetchHostSyncSnapshot();
      setMetas(snap.metas);
      setLiveProcesses(snap.liveProcesses);
      setLiveSessionIds(snap.liveSessionIds);
      setLastRefreshAt(Date.now());

      const targets = new Set<string>(snap.liveSessionIds);
      const active = useSpokStore.getState().activeSessionId;
      if (active) targets.add(active);

      // Also sync recent sessions that just finished (meta still hot)
      for (const m of snap.metas.slice(0, 5)) {
        if (
          m.status === "running" ||
          m.status === "starting" ||
          m.status === "completed" ||
          m.status === "ready"
        ) {
          // Only pull if we already track it or it's live
          if (
            useSpokStore.getState().sessions[m.id] ||
            snap.liveSessionIds.includes(m.id) ||
            m.id === active
          ) {
            targets.add(m.id);
          }
        }
      }

      for (const id of targets) {
        try {
          await pullAndMergeSession(id, {
            liveIds: snap.liveSessionIds,
            pulledCount: pulledCount.current,
            activateIfMissing: false,
          });
        } catch (e) {
          console.warn("[spok/sync] pull failed", id, e);
        }
      }

      // Clear stale running flags on sessions not live on host
      const store = useSpokStore.getState();
      const liveSet = new Set(snap.liveSessionIds);
      for (const s of Object.values(store.sessions)) {
        if (
          (s.status === "running" || s.status === "starting") &&
          !liveSet.has(s.id)
        ) {
          // Confirm via merge once more for active only
          if (s.id === store.activeSessionId) {
            try {
              await pullAndMergeSession(s.id, {
                liveIds: snap.liveSessionIds,
                pulledCount: pulledCount.current,
              });
            } catch {
              store.updateSession(s.id, { status: "ready" });
            }
          } else {
            store.updateSession(s.id, { status: "ready" });
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRefreshing(false);
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      // Skip network work when the window is backgrounded.
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      void refresh();
    };

    void refresh();

    // Single interval: faster while the active session is live, otherwise baseline.
    // Previously BASE + LIVE both ran at once (~3× more pull traffic).
    const isLive =
      activeStatus === "running" || activeStatus === "starting";
    const ms = isLive ? LIVE_POLL_MS : BASE_POLL_MS;
    const t = setInterval(tick, ms);

    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, refresh, activeStatus]);

  const activeLive =
    !!activeSessionId && liveSessionIds.includes(activeSessionId);
  const anyLive = liveSessionIds.length > 0;

  return {
    metas,
    liveProcesses,
    liveSessionIds,
    activeLive,
    anyLive,
    lastRefreshAt,
    refreshing,
    error,
    refresh,
  };
}
