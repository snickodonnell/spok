"use client";

import { useEffect, useRef } from "react";
import { useSpokStore } from "@/lib/store";
import { localFetch } from "@/lib/local-api-client";
import { syncDiffsFromGit } from "@/lib/git/client";

/**
 * Poll git working tree for live diffs while a harness run is in progress.
 * Disabled on idle/ready workspaces — use Diff refresh or end-of-run snapshot instead.
 */
export function useGitWatch(
  cwd: string | undefined,
  enabled: boolean,
  intervalMs = 2500
) {
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const lastKey = useRef("");

  useEffect(() => {
    if (!enabled || !cwd || !activeSessionId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        // Lightweight status fingerprint first
        const stRes = await localFetch(
          `/api/session/git?cwd=${encodeURIComponent(cwd)}`
        );
        if (!stRes.ok || cancelled) return;
        const st = (await stRes.json()) as {
          timestamp?: number;
          stagedCount?: number;
          unstagedCount?: number;
          untrackedCount?: number;
          files?: Array<{ path: string; code: string }>;
          branch?: { current?: string | null; headOid?: string | null };
        };
        const key = [
          st.branch?.current,
          st.branch?.headOid,
          st.stagedCount,
          st.unstagedCount,
          st.untrackedCount,
          (st.files ?? []).map((f) => f.path + f.code).join("|"),
        ].join("\n");
        if (key === lastKey.current) return;
        lastKey.current = key;

        if (cancelled) return;
        await syncDiffsFromGit(activeSessionId, cwd);
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
  }, [cwd, enabled, intervalMs, activeSessionId]);
}
