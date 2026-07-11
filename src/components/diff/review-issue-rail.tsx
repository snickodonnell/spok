"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import type { LocatedReviewIssue } from "@/lib/review-issue-location";
import { cn } from "@/lib/utils";

export function ReviewIssueRail({
  issues,
  activeIssueId,
  onOpen,
}: {
  issues: readonly LocatedReviewIssue[];
  activeIssueId?: string | null;
  onOpen: (located: LocatedReviewIssue) => void;
}) {
  if (issues.length === 0) return null;

  const selectedIndex = Math.max(
    0,
    issues.findIndex((entry) => entry.issue.id === activeIssueId)
  );
  const selected = issues[selectedIndex];
  const move = (delta: -1 | 1) => {
    const next = (selectedIndex + delta + issues.length) % issues.length;
    onOpen(issues[next]);
  };
  const Icon =
    selected.issue.kind === "secret" || selected.issue.kind === "policy"
      ? ShieldAlert
      : AlertTriangle;

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 border-b px-2 text-[10px]",
        selected.issue.severity === "error"
          ? "border-red-400/20 bg-red-500/[0.045]"
          : "border-phosphor-amber/20 bg-phosphor-amber/[0.035]"
      )}
      role="region"
      aria-label={`${issues.length} review issue${issues.length === 1 ? "" : "s"} in this file`}
      data-testid="review-issue-rail"
    >
      <button
        type="button"
        onClick={() => onOpen(selected)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/50"
        title={`${selected.issue.title}\n${selected.issue.detail}`}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            selected.issue.severity === "error"
              ? "text-red-400"
              : "text-phosphor-amber"
          )}
        />
        <span className="shrink-0 font-mono uppercase tracking-wider text-phosphor-green/45">
          Issue {selectedIndex + 1}/{issues.length}
        </span>
        <span className="truncate font-medium text-phosphor-green/85">
          {selected.issue.title}
        </span>
        <span className="hidden truncate text-phosphor-green/35 xl:inline">
          {selected.precision === "file"
            ? `file · ${selected.issue.detail}`
            : `L${selected.lineNumber} · ${selected.issue.detail}`}
        </span>
      </button>
      {issues.length > 1 && (
        <div className="flex shrink-0 items-center" aria-label="Issue navigation">
          <button
            type="button"
            className="rounded p-1 text-phosphor-green/45 hover:bg-phosphor-green/10 hover:text-phosphor-green focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/50"
            onClick={() => move(-1)}
            aria-label="Previous issue"
            title="Previous issue"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-phosphor-green/45 hover:bg-phosphor-green/10 hover:text-phosphor-green focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/50"
            onClick={() => move(1)}
            aria-label="Next issue"
            title="Next issue"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

