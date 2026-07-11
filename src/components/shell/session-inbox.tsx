"use client";

/**
 * Mission-control session inbox: lane-grouped sessions with operational labels.
 * Pure list UI — parent owns selection / delete / data loading.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Circle,
  GitBranch,
  HardDrive,
  History,
  Inbox,
  Layers,
  Loader2,
  Pause,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  INBOX_LANE_META,
  type InboxEntry,
  type InboxLane,
  type SessionInbox,
} from "@/lib/session-inbox";
import { cn, formatRelativeTime } from "@/lib/utils";

const LANE_DOT: Record<InboxLane, string> = {
  waiting: "text-phosphor-amber fill-phosphor-amber",
  running: "text-phosphor-green fill-phosphor-green",
  queued: "text-phosphor-cyan/80 fill-phosphor-cyan/80",
  failed: "text-red-400 fill-red-400",
  ready_review: "text-phosphor-cyan fill-phosphor-cyan",
  idle: "text-phosphor-green/30 fill-phosphor-green/30",
};

const LANE_HEADER: Record<InboxLane, string> = {
  waiting: "text-phosphor-amber/90",
  running: "text-phosphor-green/80",
  queued: "text-phosphor-cyan/70",
  failed: "text-red-400/90",
  ready_review: "text-phosphor-cyan/85",
  idle: "text-phosphor-green/40",
};

function sourceLabel(source: InboxEntry["source"]): string {
  switch (source) {
    case "resume":
      return "restored";
    case "live":
      return "live";
    case "sample":
      return "sample";
    case "import":
    case "paste":
      return "import";
    case "playback":
      return "playback";
    default:
      return source;
  }
}

function LaneIcon({ lane, className }: { lane: InboxLane; className?: string }) {
  if (lane === "running") {
    return <Loader2 className={cn("h-3 w-3 animate-spin", className)} />;
  }
  if (lane === "waiting") {
    return <AlertTriangle className={cn("h-3 w-3", className)} />;
  }
  if (lane === "queued") {
    return <Pause className={cn("h-3 w-3", className)} />;
  }
  if (lane === "failed") {
    return <Circle className={cn("h-2.5 w-2.5 fill-current", className)} />;
  }
  if (lane === "ready_review") {
    return <Inbox className={cn("h-3 w-3", className)} />;
  }
  return <Circle className={cn("h-2 w-2 fill-current", className)} />;
}

export function SessionInboxPanel({
  inbox,
  activeSessionId,
  onSelect,
  onDelete,
  emptyHint,
  className,
  /** Collapse idle group when there is other work (default true). */
  collapseIdleWhenBusy = true,
  testId = "session-inbox",
}: {
  inbox: SessionInbox;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  emptyHint?: string;
  className?: string;
  collapseIdleWhenBusy?: boolean;
  testId?: string;
}) {
  const { groups, summary } = inbox;
  const busyElsewhere =
    summary.activeCount + summary.attentionCount + summary.readyReviewCount > 0;

  /** User-toggled lane open state; seeded from operational defaults. */
  const [openLanes, setOpenLanes] = useState<Partial<Record<InboxLane, boolean>>>(
    {}
  );

  const laneKey = groups.map((g) => g.lane).join("|");

  // Seed defaults when a lane first appears (do not clobber user toggles).
  useEffect(() => {
    const lanes = laneKey.split("|").filter(Boolean) as InboxLane[];
    setOpenLanes((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const lane of lanes) {
        if (next[lane] !== undefined) continue;
        const open =
          lane !== "idle" || !collapseIdleWhenBusy || !busyElsewhere;
        next[lane] = open;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [laneKey, collapseIdleWhenBusy, busyElsewhere]);

  if (summary.total === 0) {
    return (
      <div
        className={cn("px-1 py-2 text-[11px] text-phosphor-green/30", className)}
        data-testid={testId}
      >
        {emptyHint ??
          "No sessions yet — open a repo to start. Live sessions are saved to disk automatically."}
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid={testId}>
      <div
        className="mb-1.5 flex items-center gap-1.5 px-1"
        data-testid="session-inbox-summary"
        title={summary.headline}
      >
        <span className="truncate text-[10px] text-phosphor-green/45">
          {summary.headline}
        </span>
        {summary.attentionCount > 0 && (
          <Badge variant="amber" className="h-4 shrink-0 px-1 text-[8px]">
            {summary.attentionCount}
          </Badge>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 pr-1">
          {groups.map(({ lane, entries }) => {
            const meta = INBOX_LANE_META[lane];
            const isOpen =
              openLanes[lane] ??
              (lane !== "idle" || !collapseIdleWhenBusy || !busyElsewhere);

            return (
              <div
                key={lane}
                className="group/lane"
                data-testid={`inbox-lane-${lane}`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenLanes((prev) => ({
                      ...prev,
                      [lane]: !isOpen,
                    }))
                  }
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] uppercase tracking-widest",
                    "hover:bg-phosphor-green/5",
                    LANE_HEADER[lane]
                  )}
                  aria-expanded={isOpen}
                >
                  <LaneIcon lane={lane} className="shrink-0 opacity-80" />
                  <span className="font-medium">{meta.label}</span>
                  <span className="ml-auto font-mono text-[9px] opacity-60">
                    {entries.length}
                  </span>
                </button>
                {isOpen && (
                  <ul className="mt-0.5 space-y-0.5">
                    {entries.map((entry) => (
                      <li key={entry.sessionId}>
                        <InboxRow
                          entry={entry}
                          active={activeSessionId === entry.sessionId}
                          onSelect={() => onSelect(entry.sessionId)}
                          onDelete={
                            onDelete
                              ? () => onDelete(entry.sessionId)
                              : undefined
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function InboxRow({
  entry,
  active,
  onSelect,
  onDelete,
}: {
  entry: InboxEntry;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const src = sourceLabel(entry.source);

  return (
    <div
      className={cn(
        "group mb-0.5 rounded border px-1.5 py-1.5 text-xs transition-colors",
        active
          ? "border-phosphor-green/35 bg-phosphor-green/12 text-phosphor-green"
          : "border-transparent text-phosphor-green/55 hover:border-phosphor-green/15 hover:bg-phosphor-green/5"
      )}
      data-testid={`inbox-row-${entry.sessionId}`}
      data-lane={entry.lane}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={onSelect}
          title={entry.cwd || entry.name}
        >
          <Circle
            className={cn(
              "h-2 w-2 shrink-0",
              LANE_DOT[entry.lane],
              entry.lane === "running" && "animate-pulse"
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        </button>
        {onDelete && (
          <button
            type="button"
            className="hidden shrink-0 rounded p-0.5 text-phosphor-red/70 hover:bg-red-500/10 group-hover:block"
            onClick={onDelete}
            title="Delete session (also removes disk log)"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onSelect}
        className="mt-0.5 flex w-full flex-wrap items-center gap-1 pl-3.5 text-left"
      >
        <span
          className={cn(
            "truncate font-mono text-[9px]",
            entry.lane === "waiting" || entry.lane === "failed"
              ? "text-phosphor-amber/80"
              : entry.lane === "ready_review"
                ? "text-phosphor-cyan/70"
                : "text-phosphor-green/40"
          )}
          title={entry.reason}
        >
          {entry.reason}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9px] text-phosphor-green/25">
          {formatRelativeTime(entry.updatedAt)}
        </span>
      </button>

      <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-3.5">
        <Badge
          variant={entry.source === "resume" ? "cyan" : "muted"}
          className="h-4 px-1 text-[8px] uppercase"
        >
          {entry.source === "resume" ? (
            <span className="inline-flex items-center gap-0.5">
              <History className="h-2 w-2" />
              {src}
            </span>
          ) : (
            src
          )}
        </Badge>
        {entry.durable &&
          (entry.source === "live" || entry.source === "resume") && (
            <Badge variant="muted" className="h-4 px-1 text-[8px]">
              <HardDrive className="mr-0.5 inline h-2 w-2" />
              disk
            </Badge>
          )}
        {entry.backgroundJob && (
          <Badge variant="muted" className="h-4 px-1 text-[8px]">
            <Layers className="mr-0.5 inline h-2 w-2" />
            job
          </Badge>
        )}
        {entry.branch && (
          <span
            className="inline-flex max-w-[7rem] items-center gap-0.5 truncate font-mono text-[9px] text-phosphor-green/30"
            title={entry.branch}
          >
            <GitBranch className="h-2 w-2 shrink-0" />
            {entry.branch}
          </span>
        )}
        {entry.filesChanged > 0 && (
          <span className="font-mono text-[9px] text-phosphor-green/30">
            {entry.filesChanged} file{entry.filesChanged === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {entry.cwd && (
        <div
          className="mt-0.5 truncate pl-3.5 font-mono text-[9px] text-phosphor-green/25"
          title={entry.cwd}
        >
          {entry.cwd}
        </div>
      )}
    </div>
  );
}
