"use client";

import { useEffect, useRef } from "react";
import {
  getCachedCapabilityToken,
  getCapabilityToken,
} from "@/lib/local-api-client";
import {
  stopActiveHarnessIfLive,
  stopHarnessProcess,
} from "@/lib/session-lifecycle-client";
import { useSpokStore } from "@/lib/store";

/**
 * Mobile-only: kill the host Grok process when the user leaves the page
 * (close tab, navigate away, background long enough).
 *
 * Uses fetch keepalive + cached capability token so stop works on pagehide.
 */
export function useMobileSessionLifecycle(enabled = true) {
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Prime capability token early so pagehide can stop without awaiting health
    void getCapabilityToken().catch(() => undefined);

    const clearHiddenTimer = () => {
      if (hiddenTimer.current) {
        clearTimeout(hiddenTimer.current);
        hiddenTimer.current = null;
      }
    };

    const killActive = (reason: string) => {
      const id = useSpokStore.getState().activeSessionId;
      if (!id) return;
      const s = useSpokStore.getState().sessions[id];
      if (!s) return;
      if (
        s.status !== "running" &&
        s.status !== "starting" &&
        s.status !== "paused"
      ) {
        return;
      }
      console.info("[spok/mobile] stopping session on", reason, id);
      void stopHarnessProcess(id, { keepalive: true });
    };

    const onPageHide = () => {
      killActive("pagehide");
    };

    const onBeforeUnload = () => {
      killActive("beforeunload");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Grace period: brief app switch / notification shade
        clearHiddenTimer();
        hiddenTimer.current = setTimeout(() => {
          if (document.visibilityState === "hidden") {
            killActive("visibility-hidden");
          }
        }, 12_000);
      } else {
        clearHiddenTimer();
        // Re-arm token after return
        void getCapabilityToken().catch(() => undefined);
      }
    };

    // freeze is fired on mobile when backgrounded (more reliable than hide alone)
    const onFreeze = () => {
      killActive("freeze");
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("freeze", onFreeze);

    armed.current = true;

    return () => {
      clearHiddenTimer();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("freeze", onFreeze);
      // Unmounting mobile shell (e.g. force desktop) — stop live run
      if (armed.current) {
        void stopActiveHarnessIfLive({ keepalive: true });
      }
      armed.current = false;
    };
  }, [enabled]);

  // Keep token warm while a run is live
  const status = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.status : undefined
  );
  useEffect(() => {
    if (!enabled) return;
    if (status === "running" || status === "starting") {
      void getCapabilityToken().catch(() => undefined);
    }
  }, [enabled, status]);

  // Touch cache so tree-shakers keep export
  void getCachedCapabilityToken;
}
