"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ListTree,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import {
  buildReviewQueue,
  type ReviewGroupId,
  type ReviewIssueMarker,
  type ReviewQueueItem,
} from "@/lib/review-queue";
import { FileRiskBadge } from "./file-risk-badge";
import { DiffStatChip } from "./monaco-diff";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DiffStatus } from "@/lib/types";

function statusLetter(status: DiffStatus) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    default:
      return "?";
  }
}

function statusColor(status: DiffStatus) {
  switch (status) {
    case "added":
      return "text-phosphor-green";
    case "deleted":
      return "text-phosphor-red";
    case "modified":
      return "text-phosphor-amber";
    case "renamed":
      return "text-phosphor-cyan";
    default:
      return "text-phosphor-green/50";
  }
}

function IssueRow({
  issue,
  onOpen,
}: {
  issue: ReviewIssueMarker;
  onOpen: (issue: ReviewIssueMarker) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(issue)}
      className={cn(
        "flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-[10px] transition",
        "hover:bg-phosphor-green/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/40",
        issue.severity === "error" && "bg-red-500/5",
        issue.severity === "warn" && "bg-phosphor-amber/5"
      )}
    >
      {issue.kind === "secret" || issue.kind === "policy" ? (
        <ShieldAlert
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0",
            issue.severity === "error" ? "text-red-400" : "text-phosphor-amber"
          )}
        />
      ) : (
        <AlertTriangle
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0",
            issue.severity === "error" ? "text-red-400" : "text-phosphor-amber"
          )}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-phosphor-green/85">
          {issue.title}
        </span>
        <span className="block truncate text-phosphor-green/40">
          {issue.path || issue.detail}
        </span>
      </span>
    </button>
  );
}

function QueueFileRow({
  item,
  issueCount,
  selected,
  onSelect,
}: {
  item: ReviewQueueItem;
  issueCount: number;
  selected: boolean;
  onSelect: (fileId: string) => void;
}) {
  const base = item.path.includes("/")
    ? item.path.slice(item.path.lastIndexOf("/") + 1)
    : item.path;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.fileId)}
      className={cn(
        "flex w-full items-center gap-1.5 border-l-2 px-2 py-1 text-left text-xs transition-colors",
        selected
          ? "border-phosphor-green bg-phosphor-green/12 text-phosphor-green"
          : "border-transparent text-phosphor-green/80 hover:bg-phosphor-green/5"
      )}
      title={`${item.path}\n${item.intentSummary}`}
      data-testid="review-queue-file"
      data-risk={item.risk.kind}
    >
      <span
        className={cn(
          "w-3 shrink-0 text-center font-mono text-[10px] font-bold",
          statusColor(item.status)
        )}
      >
        {statusLetter(item.status)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
        {base}
      </span>
      {item.conflict && (
        <span className="text-[8px] font-bold text-red-400">C</span>
      )}
      {item.staged && (
        <span className="text-[8px] font-bold text-phosphor-green" title="Staged">
          S
        </span>
      )}
      {issueCount > 0 && (
        <span
          className="flex shrink-0 items-center gap-0.5 font-mono text-[9px] text-phosphor-amber"
          title={`${issueCount} open review issue${issueCount === 1 ? "" : "s"}`}
          aria-label={`${issueCount} open review issue${issueCount === 1 ? "" : "s"}`}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {issueCount}
        </span>
      )}
      <FileRiskBadge risk={item.risk} compact />
      <DiffStatChip
        className="scale-90"
        additions={item.additions}
        deletions={item.deletions}
      />
    </button>
  );
}

/**
 * Risk-ordered review queue for the Changes left rail.
 * Groups by security / config / source / tests / docs with issue markers.
 */
export function ReviewQueuePanel({
  className,
}: {
  className?: string;
}) {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const setLeftTraceMode = useSpokStore((s) => s.setLeftTraceMode);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<ReviewGroupId>>(new Set());
  const [issuesOpen, setIssuesOpen] = useState(true);

  const queue = useMemo(
    () => (session ? buildReviewQueue(session) : null),
    [session]
  );

  const filteredGroups = useMemo(() => {
    if (!queue) return [];
    const q = search.trim().toLowerCase();
    if (!q) return queue.groups;
    return queue.groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            i.path.toLowerCase().includes(q) ||
            i.risk.label.toLowerCase().includes(q) ||
            i.intentSummary.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [queue, search]);

  const issueCountByFile = useMemo(() => {
    const counts = new Map<string, number>();
    if (!queue) return counts;
    const fileIdByPath = new Map(
      queue.flat.map((item) => [item.path.replace(/\\/g, "/"), item.fileId])
    );
    for (const issue of queue.issues) {
      const fileId =
        issue.fileId ??
        (issue.path
          ? fileIdByPath.get(issue.path.replace(/\\/g, "/"))
          : undefined);
      if (fileId) counts.set(fileId, (counts.get(fileId) ?? 0) + 1);
    }
    return counts;
  }, [queue]);

  if (!session || !queue) return null;

  const toggleGroup = (id: ReviewGroupId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onIssue = (issue: ReviewIssueMarker) => {
    const normalizedPath = issue.path?.replace(/\\/g, "/");
    const targetFileId =
      issue.fileId ??
      (normalizedPath
        ? Object.values(session.files).find(
            (file) => file.path.replace(/\\/g, "/") === normalizedPath
          )?.id
        : undefined);
    if (targetFileId) {
      selectFile(targetFileId);
    }
    if (issue.traceNodeId) {
      selectTrace(issue.traceNodeId);
      setLeftTraceMode("events");
    }
    if (!targetFileId && issue.traceNodeId) {
      setWorkspaceRightTab("validation");
    }
  };

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      data-testid="review-queue-panel"
    >
      <div className="space-y-2 border-b border-phosphor-green/15 p-2">
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-phosphor-green/45">
          <span className="flex items-center gap-1">
            <ListTree className="h-3 w-3" />
            Review queue
          </span>
          <DiffStatChip
            additions={queue.flat.reduce((s, f) => s + f.additions, 0)}
            deletions={queue.flat.reduce((s, f) => s + f.deletions, 0)}
          />
        </div>
        <div
          className={cn(
            "rounded border px-2 py-1 font-mono text-[10px]",
            queue.summary.needsAttention
              ? "border-phosphor-amber/35 text-phosphor-amber"
              : "border-phosphor-green/20 text-phosphor-green/70"
          )}
          data-testid="review-queue-headline"
        >
          {queue.summary.headline}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-phosphor-green/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by path or risk…"
            className="h-7 pl-7 text-xs"
            aria-label="Filter review queue"
          />
        </div>
      </div>

      {queue.issues.length > 0 && (
        <div className="border-b border-phosphor-green/10">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px] uppercase tracking-widest text-phosphor-amber/80 hover:bg-phosphor-amber/5"
            onClick={() => setIssuesOpen((v) => !v)}
          >
            {issuesOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Issues
            <span className="ml-auto rounded bg-phosphor-amber/15 px-1 font-mono text-[9px] normal-case tracking-normal text-phosphor-amber">
              {queue.issues.length}
            </span>
          </button>
          {issuesOpen && (
            <div className="max-h-28 space-y-0.5 overflow-auto pb-1">
              {queue.issues.slice(0, 12).map((issue) => (
                <IssueRow key={issue.id} issue={issue} onOpen={onIssue} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {queue.flat.length === 0 ? (
          <div className="p-4 text-center text-xs text-phosphor-green/35">
            No file changes yet
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-4 text-center text-xs text-phosphor-green/35">
            No files match filter
          </div>
        ) : (
          filteredGroups.map((group) => {
            const closed = collapsed.has(group.id);
            return (
              <div key={group.id} className="mb-0.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-phosphor-green/5"
                  onClick={() => toggleGroup(group.id)}
                >
                  {closed ? (
                    <ChevronRight className="h-3 w-3 text-phosphor-green/40" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-phosphor-green/40" />
                  )}
                  <span className="text-[10px] font-medium uppercase tracking-wider text-phosphor-green/55">
                    {group.label}
                  </span>
                  <span className="font-mono text-[9px] text-phosphor-green/30">
                    {group.items.length}
                  </span>
                </button>
                {!closed &&
                  group.items.map((item) => (
                    <QueueFileRow
                      key={item.fileId}
                      item={item}
                      issueCount={issueCountByFile.get(item.fileId) ?? 0}
                      selected={session.selectedFileId === item.fileId}
                      onSelect={selectFile}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-phosphor-green/10 px-2 py-1.5 text-[9px] text-phosphor-green/35">
        <kbd className="rounded border border-phosphor-green/20 px-1 font-mono">
          j
        </kbd>
        /
        <kbd className="rounded border border-phosphor-green/20 px-1 font-mono">
          k
        </kbd>{" "}
        files ·{" "}
        <kbd className="rounded border border-phosphor-green/20 px-1 font-mono">
          n
        </kbd>
        /
        <kbd className="rounded border border-phosphor-green/20 px-1 font-mono">
          p
        </kbd>{" "}
        hunks ·{" "}
        <kbd className="rounded border border-phosphor-green/20 px-1 font-mono">
          w
        </kbd>{" "}
        why
      </div>
    </div>
  );
}
