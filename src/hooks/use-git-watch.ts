"use client";

import { useEffect, useRef } from "react";
import { useSpokStore } from "@/lib/store";
import { parseUnifiedDiff } from "@/lib/diff-utils";

/**
 * Poll git working tree for live diffs while a session is running.
 */
export function useGitWatch(cwd: string | undefined, enabled: boolean, intervalMs = 2000) {
  const upsertFileDiff = useSpokStore((s) => s.upsertFileDiff);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const lastDiff = useRef("");

  useEffect(() => {
    if (!enabled || !cwd || !activeSessionId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/session/git-diff?cwd=${encodeURIComponent(cwd)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { diff?: string };
        const diff = data.diff ?? "";
        if (diff && diff !== lastDiff.current) {
          lastDiff.current = diff;
          const files = parseUnifiedDiff(diff);
          for (const f of files) {
            upsertFileDiff(activeSessionId, f);
          }
        }
      } catch {
        /* ignore poll errors */
      }
    };

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cwd, enabled, intervalMs, activeSessionId, upsertFileDiff]);
}
