"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  FileCode2,
  FlaskConical,
  Hammer,
  Loader2,
  ShieldAlert,
  ShieldQuestion,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import {
  buildValidationLane,
  filterValidationItems,
  type ValidationFilter,
  type ValidationItem,
  type ValidationKind,
  type ValidationStatus,
} from "@/lib/validation-lane";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Always-available validation lane: tools, tests, builds, approvals, policy,
 * and run outcomes in time order with jump-to-trace / jump-to-file.
 */
export function ValidationPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const selectFile = useSpokStore((s) => s.selectFile);
  const setLeftTraceMode = useSpokStore((s) => s.setLeftTraceMode);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const autoScroll = session?.config.autoScroll !== false;
  const isLive =
    session?.status === "running" || session?.status === "starting";

  const [filter, setFilter] = useState<ValidationFilter>("all");
  const bottomRef = useRef<HTMLDivElement>(null);

  const lane = useMemo(
    () => (session ? buildValidationLane(session) : null),
    [session]
  );

  const visible = useMemo(
    () => (lane ? filterValidationItems(lane.items, filter) : []),
    [lane, filter]
  );

  const fingerprint = visible
    .map((i) => `${i.id}:${i.status}`)
    .join("|");

  useEffect(() => {
    if (!autoScroll || !isLive) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [fingerprint, autoScroll, isLive]);

  if (!session || !lane) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Open a session to see validation activity
      </div>
    );
  }

  const onSelect = (item: ValidationItem) => {
    if (item.traceNodeId) {
      selectTrace(item.traceNodeId);
      setLeftTraceMode("events");
    }
    if (item.fileIds[0]) {
      selectFile(item.fileIds[0]);
    } else if (item.paths[0]) {
      // Prefer opening Changes when we only know a path label
      setWorkspaceRightTab("changes");
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="validation-panel"
    >
      <div className="shrink-0 border-b border-phosphor-green/15 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-phosphor-green/80">
              Validation
            </h2>
            <p className="mt-0.5 text-[10px] text-phosphor-green/40">
              Commands, tools, tests, builds, approvals — click to jump to the
              event or file
            </p>
          </div>
          <div
            className={cn(
              "shrink-0 rounded border px-2 py-1 font-mono text-[10px]",
              lane.summary.needsAttention
                ? "border-phosphor-amber/40 text-phosphor-amber"
                : "border-phosphor-green/20 text-phosphor-green/70"
            )}
            data-testid="validation-headline"
          >
            {lane.summary.headline}
          </div>
        </div>
        <div
          className="mt-2 flex flex-wrap gap-1"
          role="toolbar"
          aria-label="Validation filters"
        >
          {(
            [
              ["all", "All"],
              ["attention", "Attention"],
              ["failures", "Failures"],
              ["running", "Running"],
              ["tests", "Tests/Builds"],
              ["approvals", "Policy"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] transition",
                filter === id
                  ? "bg-phosphor-green/15 text-phosphor-green"
                  : "text-phosphor-green/45 hover:bg-phosphor-green/8 hover:text-phosphor-green/75"
              )}
            >
              {label}
              {id === "all" && lane.summary.total > 0 && (
                <span className="ml-1 opacity-60">{lane.summary.total}</span>
              )}
              {id === "failures" &&
                lane.summary.failed + lane.summary.blocked > 0 && (
                  <span className="ml-1 text-phosphor-amber">
                    {lane.summary.failed + lane.summary.blocked}
                  </span>
                )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-phosphor-green/35">
            {lane.items.length === 0
              ? "No tools, tests, or policy events yet — they appear here as the agent runs."
              : "No items match this filter."}
          </div>
        ) : (
          <ul className="divide-y divide-phosphor-green/8 px-1 py-1">
            {visible.map((item) => (
              <li key={item.id}>
                <ValidationRow item={item} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ValidationRow({
  item,
  onSelect,
}: {
  item: ValidationItem;
  onSelect: (item: ValidationItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "flex w-full gap-2 rounded px-2 py-1.5 text-left transition",
        "hover:bg-phosphor-green/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/40",
        item.severity === "error" && "bg-red-500/5",
        item.severity === "warn" && item.status === "blocked" && "bg-phosphor-amber/5"
      )}
      data-testid="validation-item"
      data-kind={item.kind}
      data-status={item.status}
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={item.status} kind={item.kind} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <KindIcon kind={item.kind} />
          <span className="truncate font-mono text-[11px] text-phosphor-green/90">
            {item.title}
          </span>
          {item.attempt != null && item.attempt > 1 && (
            <span className="rounded bg-phosphor-cyan/15 px-1 font-mono text-[9px] text-phosphor-cyan">
              retry {item.attempt}
            </span>
          )}
          {item.exitCode != null && (
            <span
              className={cn(
                "ml-auto shrink-0 font-mono text-[9px]",
                item.exitCode === 0
                  ? "text-phosphor-green/50"
                  : "text-phosphor-amber"
              )}
            >
              exit {item.exitCode}
            </span>
          )}
          {item.durationMs != null && item.durationMs > 0 && (
            <span className="shrink-0 font-mono text-[9px] text-phosphor-green/35">
              {formatDuration(item.durationMs)}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-phosphor-green/50">
          {item.detail}
        </p>
        {(item.paths.length > 0 || item.command) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.command && (
              <span className="inline-flex max-w-full items-center gap-0.5 truncate rounded bg-black/30 px-1 font-mono text-[9px] text-phosphor-green/45">
                <Terminal className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{item.command}</span>
              </span>
            )}
            {item.paths.slice(0, 3).map((p) => (
              <span
                key={p}
                className="inline-flex max-w-[12rem] items-center gap-0.5 truncate rounded bg-phosphor-green/8 px-1 font-mono text-[9px] text-phosphor-cyan/70"
              >
                <FileCode2 className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{p}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 self-center">
        {item.traceNodeId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-[9px] text-phosphor-green/50"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item);
            }}
          >
            Open
          </Button>
        )}
      </div>
    </button>
  );
}

function StatusIcon({
  status,
  kind,
}: {
  status: ValidationStatus;
  kind: ValidationKind;
}) {
  const cls = "h-3.5 w-3.5";
  if (status === "running") {
    return <Loader2 className={cn(cls, "animate-spin text-phosphor-cyan")} />;
  }
  if (status === "pending") {
    return <Clock className={cn(cls, "text-phosphor-green/40")} />;
  }
  if (status === "success") {
    return <CheckCircle2 className={cn(cls, "text-phosphor-green")} />;
  }
  if (status === "blocked") {
    return kind === "approval" ? (
      <ShieldQuestion className={cn(cls, "text-phosphor-amber")} />
    ) : (
      <ShieldAlert className={cn(cls, "text-phosphor-amber")} />
    );
  }
  if (status === "skipped") {
    return <CircleDot className={cn(cls, "text-phosphor-green/35")} />;
  }
  return <XCircle className={cn(cls, "text-red-400")} />;
}

function KindIcon({ kind }: { kind: ValidationKind }) {
  const cls = "h-3 w-3 shrink-0 text-phosphor-green/40";
  switch (kind) {
    case "test":
      return <FlaskConical className={cls} />;
    case "build":
      return <Hammer className={cls} />;
    case "tool":
      return <Wrench className={cls} />;
    case "run":
    case "command":
      return <Terminal className={cls} />;
    case "approval":
    case "policy":
      return <ShieldAlert className={cls} />;
    case "error":
    case "parser":
      return <AlertTriangle className={cls} />;
    default:
      return <CircleDot className={cls} />;
  }
}
