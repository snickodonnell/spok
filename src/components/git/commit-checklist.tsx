"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ClipboardList,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import {
  buildReviewReadiness,
  type ChecklistSeverity,
} from "@/lib/review-readiness";
import { cn } from "@/lib/utils";

function SeverityIcon({ severity }: { severity: ChecklistSeverity }) {
  const cls = "h-3 w-3 shrink-0";
  switch (severity) {
    case "ok":
      return <CheckCircle2 className={cn(cls, "text-phosphor-green")} />;
    case "warn":
      return <AlertTriangle className={cn(cls, "text-phosphor-amber")} />;
    case "block":
      return <XCircle className={cn(cls, "text-red-400")} />;
    default:
      return <Info className={cn(cls, "text-phosphor-cyan/70")} />;
  }
}

/**
 * Pre-commit checklist: staged files, comments, secrets, run state, isolation.
 */
export function CommitChecklist({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );

  const readiness = useMemo(
    () => (session ? buildReviewReadiness(session) : null),
    [session]
  );

  if (!session || !readiness) return null;

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded border px-2 py-1 text-[10px]",
          readiness.readyToCommit
            ? readiness.summary.includes("warning")
              ? "border-phosphor-amber/30 text-phosphor-amber"
              : "border-phosphor-green/25 text-phosphor-green/70"
            : "border-red-500/30 text-red-400/90",
          className
        )}
        data-testid="commit-checklist-compact"
        title={readiness.items.map((i) => `${i.label}: ${i.detail}`).join("\n")}
      >
        <ClipboardList className="h-3 w-3" />
        <span className="font-medium">{readiness.summary}</span>
        <span className="text-phosphor-green/35">
          · {readiness.stagedCount} staged
          {readiness.unresolvedComments > 0 &&
            ` · ${readiness.unresolvedComments} comments`}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-phosphor-green/15 bg-black/25 p-2",
        className
      )}
      data-testid="commit-checklist"
      role="region"
      aria-label="Commit readiness"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-phosphor-green/70">
        <ClipboardList className="h-3 w-3" />
        Commit readiness
        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[9px]",
            readiness.readyToCommit
              ? "bg-phosphor-green/10 text-phosphor-green"
              : "bg-red-500/10 text-red-400"
          )}
        >
          {readiness.summary}
        </span>
      </div>
      <ul className="space-y-1">
        {readiness.items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-1.5 text-[11px] text-phosphor-green/65"
          >
            <SeverityIcon severity={item.severity} />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-phosphor-green/85">
                {item.label}
              </span>
              <span className="text-phosphor-green/40"> — {item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useCommitReadiness() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  return useMemo(
    () => (session ? buildReviewReadiness(session) : null),
    [session]
  );
}
