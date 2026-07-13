"use client";

import { useEffect } from "react";
import { getCapabilityToken } from "@/lib/local-api-client";
import { useSpokStore } from "@/lib/store";

/**
 * Mobile client presence lifecycle.
 *
 * Passive lifecycle events are connectivity signals only. They never authorize
 * stopping or mutating a host run. Explicit scoped stop controls own that intent.
 */
export function useMobileSessionLifecycle(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const warmCapability = () => {
      void getCapabilityToken().catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") warmCapability();
    };

    warmCapability();
    window.addEventListener("pageshow", warmCapability);
    window.addEventListener("online", warmCapability);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pageshow", warmCapability);
      window.removeEventListener("online", warmCapability);
      document.removeEventListener("visibilitychange", onVisibility);
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
}
