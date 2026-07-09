"use client";

import { useEffect } from "react";
import { useSpokStore } from "@/lib/store";
import { applyThemeToDocument, resolveThemeEffects } from "@/lib/theme";

/**
 * Keep document `data-theme` and motion classes in sync with the store.
 * Also respects OS prefers-reduced-motion when app setting is off.
 */
export function useThemeSync() {
  const uiTheme = useSpokStore((s) => s.uiTheme);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const scanlines = useSpokStore((s) => s.scanlines);
  const reducedMotion = useSpokStore((s) => s.reducedMotion);

  useEffect(() => {
    const effects = resolveThemeEffects({
      theme: uiTheme,
      crtEnabled,
      scanlines,
      reducedMotion,
    });

    // If user has not forced reduced motion, still honor OS preference for animations
    let osReduce = false;
    if (typeof window !== "undefined" && !reducedMotion) {
      osReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    applyThemeToDocument({
      ...effects,
      reducedMotion: effects.reducedMotion || osReduce,
      // When OS reduce is on, still drop CRT animations even if store says otherwise
      crtEffects: effects.crtEffects && !osReduce,
      scanlines: effects.scanlines && !osReduce,
    });
  }, [uiTheme, crtEnabled, scanlines, reducedMotion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      // Re-trigger by reading store and re-applying
      const s = useSpokStore.getState();
      const effects = resolveThemeEffects({
        theme: s.uiTheme,
        crtEnabled: s.crtEnabled,
        scanlines: s.scanlines,
        reducedMotion: s.reducedMotion,
      });
      const osReduce = mq.matches && !s.reducedMotion;
      applyThemeToDocument({
        ...effects,
        reducedMotion: effects.reducedMotion || osReduce,
        crtEffects: effects.crtEffects && !mq.matches,
        scanlines: effects.scanlines && !mq.matches,
      });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
}
