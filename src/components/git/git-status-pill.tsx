"use client";

import type { SessionGitSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GitBranch, GitCommitHorizontal, Layers } from "lucide-react";

export function GitStatusPill({
  summary,
  cwd,
  compact,
}: {
  summary?: SessionGitSummary | null;
  cwd?: string;
  compact?: boolean;
}) {
  if (!summary && !cwd) return null;

  const branch = summary?.branch ?? "—";
  const dirty =
    summary &&
    (summary.stagedCount > 0 ||
      summary.unstagedCount > 0 ||
      summary.untrackedCount > 0);

  return (
    <div
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2 font-mono text-[10px]",
        compact ? "gap-1.5" : "gap-2"
      )}
      title={
        [
          cwd ? `cwd: ${cwd}` : null,
          summary?.isWorktree ? "linked worktree" : null,
          summary?.upstream
            ? `upstream ${summary.upstream} +${summary.ahead}/-${summary.behind}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    >
      {summary?.isWorktree && (
        <span className="inline-flex items-center gap-0.5 rounded border border-phosphor-magenta/35 bg-phosphor-magenta/10 px-1 py-0.5 text-phosphor-magenta">
          <Layers className="h-2.5 w-2.5" />
          wt
        </span>
      )}
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5",
          dirty
            ? "border-phosphor-amber/35 bg-phosphor-amber/10 text-phosphor-amber"
            : "border-phosphor-cyan/30 bg-phosphor-cyan/10 text-phosphor-cyan"
        )}
      >
        <GitBranch className="h-2.5 w-2.5 shrink-0 opacity-80" />
        <span className="truncate max-w-[10rem]">{branch}</span>
        {summary?.ahead ? (
          <span className="text-phosphor-green">↑{summary.ahead}</span>
        ) : null}
        {summary?.behind ? (
          <span className="text-phosphor-red">↓{summary.behind}</span>
        ) : null}
      </span>
      {summary && !summary.clean && (
        <span className="inline-flex items-center gap-1 text-phosphor-green/50">
          <GitCommitHorizontal className="h-2.5 w-2.5" />
          {summary.stagedCount > 0 && (
            <span className="text-phosphor-green">{summary.stagedCount}S</span>
          )}
          {summary.unstagedCount > 0 && (
            <span className="text-phosphor-amber">{summary.unstagedCount}M</span>
          )}
          {summary.untrackedCount > 0 && (
            <span className="text-phosphor-cyan">{summary.untrackedCount}?</span>
          )}
          {summary.conflictCount > 0 && (
            <span className="text-red-400">{summary.conflictCount}!</span>
          )}
        </span>
      )}
    </div>
  );
}
