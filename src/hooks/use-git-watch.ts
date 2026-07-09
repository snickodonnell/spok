"use client";

import { useEffect, useRef } from "react";
import { useSpokStore } from "@/lib/store";
import { createFileDiff, parseUnifiedDiff } from "@/lib/diff-utils";

/**
 * Poll git working tree for live diffs while a harness run is in progress.
 * Disabled on idle/ready workspaces — use Diff refresh or end-of-run snapshot instead.
 */
export function useGitWatch(
  cwd: string | undefined,
  enabled: boolean,
  intervalMs = 2500
) {
  const upsertFileDiff = useSpokStore((s) => s.upsertFileDiff);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const lastKey = useRef("");

  useEffect(() => {
    if (!enabled || !cwd || !activeSessionId) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/session/git-diff?cwd=${encodeURIComponent(cwd)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          diff?: string;
          status?: string;
          files?: Array<{
            path: string;
            status: string;
            oldContent?: string;
            newContent?: string;
          }>;
        };

        const key = `${data.status ?? ""}\n${data.diff ?? ""}\n${(data.files ?? [])
          .map((f) => f.path + (f.newContent?.length ?? 0))
          .join("|")}`;
        if (key === lastKey.current) return;
        lastKey.current = key;

        if (data.diff) {
          for (const f of parseUnifiedDiff(data.diff)) {
            upsertFileDiff(activeSessionId, f);
          }
        }

        for (const f of data.files ?? []) {
          if (f.newContent == null && f.oldContent == null) continue;
          upsertFileDiff(
            activeSessionId,
            createFileDiff({
              path: f.path,
              oldContent: f.oldContent ?? "",
              newContent: f.newContent ?? "",
              status:
                f.status === "added" || f.status === "untracked"
                  ? "added"
                  : f.status === "deleted"
                    ? "deleted"
                    : "modified",
            })
          );
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
