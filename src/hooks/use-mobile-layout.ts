"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MOBILE_BREAKPOINT_PX,
  MOBILE_LAYOUT_STORAGE_KEY,
  readLayoutPreferenceFromSearch,
  resolveLayoutPreference,
  shouldUseMobileLayout,
  type LayoutPreference,
} from "@/lib/mobile-layout";

/**
 * Detect phone / narrow layout for the mobile shell.
 * Does not affect desktop chrome when `isMobile` is false.
 *
 * Overrides:
 * - `?mobile=1` / `?desktop=1` (persisted)
 * - localStorage `spok.layoutPreference`
 */
export function useMobileLayout() {
  const [preference, setPreferenceState] = useState<LayoutPreference>("auto");
  const [isMobile, setIsMobile] = useState(false);
  const [ready, setReady] = useState(false);

  const recompute = useCallback((pref: LayoutPreference) => {
    if (typeof window === "undefined") return false;
    const coarse =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false;
    return shouldUseMobileLayout({
      preference: pref,
      width: window.innerWidth,
      userAgent: navigator.userAgent,
      coarsePointer: coarse,
    });
  }, []);

  useEffect(() => {
    let pref: LayoutPreference = "auto";
    try {
      const fromUrl = readLayoutPreferenceFromSearch(window.location.search);
      if (fromUrl) {
        pref = fromUrl;
        localStorage.setItem(MOBILE_LAYOUT_STORAGE_KEY, fromUrl);
        // Clean query so refresh doesn't stick awkwardly (optional keep)
      } else {
        pref = resolveLayoutPreference(
          localStorage.getItem(MOBILE_LAYOUT_STORAGE_KEY)
        );
      }
    } catch {
      pref = "auto";
    }
    setPreferenceState(pref);
    setIsMobile(recompute(pref));
    setReady(true);

    const onResize = () => setIsMobile(recompute(pref));
    window.addEventListener("resize", onResize);

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const onMq = () => setIsMobile(recompute(pref));
    mq.addEventListener?.("change", onMq);

    return () => {
      window.removeEventListener("resize", onResize);
      mq.removeEventListener?.("change", onMq);
    };
  }, [recompute]);

  // Re-bind resize when preference changes
  useEffect(() => {
    if (!ready) return;
    setIsMobile(recompute(preference));
    const onResize = () => setIsMobile(recompute(preference));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [preference, ready, recompute]);

  const setPreference = useCallback((next: LayoutPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(MOBILE_LAYOUT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setIsMobile(recompute(next));
  }, [recompute]);

  return {
    /** True when mobile shell should render */
    isMobile,
    /** Detection finished (avoid flash of wrong shell) */
    ready,
    preference,
    setPreference,
  };
}
