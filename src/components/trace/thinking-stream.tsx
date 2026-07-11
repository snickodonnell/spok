"use client";

import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSpokStore } from "@/lib/store";
import { collectThoughtBlocks } from "@/lib/trace-text";
import {
  extractSubagentLanes,
  isSubagentPollutingNode,
} from "@/lib/automation/subagent-lanes";
import { cn } from "@/lib/utils";

/**
 * Permanent thinking / progress feed (virtualized for long runs).
 */
type ThinkingStreamProps = {
  compact?: boolean;
  className?: string;
};

export function ThinkingStream({
  compact = false,
  className,
}: ThinkingStreamProps = {}) {
  const sessionId = useSpokStore((s) => s.activeSessionId);
  const hasSession = !!sessionId;
  const nodes = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.nodes : undefined
  );
  // eventLog is secondary fill-in; skip while live (nodes already stream)
  // so we don't re-walk 8k events on every token.
  const eventLog = useSpokStore((s) => {
    const id = s.activeSessionId;
    if (!id) return undefined;
    const sess = s.sessions[id];
    if (!sess) return undefined;
    if (sess.status === "running" || sess.status === "starting") {
      return undefined;
    }
    return sess.eventLog;
  });
  const autoScroll = useSpokStore((s) => {
    const id = s.activeSessionId;
    return id ? s.sessions[id]?.config.autoScroll !== false : true;
  });
  const status = useSpokStore((s) => {
    const id = s.activeSessionId;
    return id ? s.sessions[id]?.status : undefined;
  });
  const hideSubagent = useSpokStore((s) => s.hideSubagentFromThinking);
  const isLive = status === "running" || status === "starting";
  const parentRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => {
    const raw = collectThoughtBlocks(nodes, eventLog);
    if (!hideSubagent || !nodes) return raw;
    const lanes = extractSubagentLanes(nodes);
    if (!lanes.length) return raw;
    return raw.filter((b) => {
      const node = nodes[b.id];
      if (!node) return true;
      return !isSubagentPollutingNode(node, lanes);
    });
  }, [nodes, eventLog, hideSubagent]);

  const progressBlocks = useMemo(
    () => blocks.filter((b) => b.kind === "progress"),
    [blocks]
  );
  const summaryBlock = useMemo(
    () => blocks.find((b) => b.kind === "summary"),
    [blocks]
  );

  // Compact mode keeps last N in DOM without virtualization cost of sticky chrome
  const shownProgress = compact ? progressBlocks.slice(-12) : progressBlocks;

  const virtualizer = useVirtualizer({
    count: compact ? 0 : shownProgress.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const t = shownProgress[i]?.text ?? "";
      return 28 + Math.min(12, Math.ceil(t.length / 80)) * 18;
    },
    overscan: 8,
  });

  useEffect(() => {
    if (!autoScroll || compact) return;
    if (shownProgress.length === 0) return;
    virtualizer.scrollToIndex(shownProgress.length - 1, { align: "end" });
  }, [shownProgress.length, autoScroll, compact, virtualizer]);

  if (!hasSession) {
    return (
      <div
        className={cn(
          "flex items-center justify-center p-6 text-sm text-phosphor-green/35",
          compact ? "h-full min-h-[8rem]" : "h-full"
        )}
      >
        No active session
      </div>
    );
  }

  if (blocks.length === 0) {
    const running =
      status === "running" || status === "starting" || status === "ready";
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-8 text-center",
          compact ? "min-h-[8rem] py-4" : "h-full"
        )}
      >
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-phosphor-amber">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-amber" />
            Live on host
          </span>
        )}
        <p className="text-sm text-phosphor-green/45">
          {running ? "Waiting for thoughts…" : "No thoughts in this session yet"}
        </p>
        {!compact && (
          <p className="max-w-xs text-[11px] leading-relaxed text-phosphor-green/28">
            Progress updates stay here as the agent works. Pulls from the host
            every few seconds while a run is active.
          </p>
        )}
      </div>
    );
  }

  const proseStyle = {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  } as const;

  if (compact) {
    return (
      <div
        className={cn(
          "overflow-y-auto px-4 py-4 max-h-56 min-h-[10rem]",
          className
        )}
        role="log"
        aria-label="Agent thinking"
        aria-live="polite"
        aria-busy={isLive}
        data-live={isLive ? "true" : "false"}
        data-testid="thinking-stream"
      >
        {isLive && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-phosphor-amber">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-amber" />
            Thinking live…
          </div>
        )}
        <div
          className="mx-auto max-w-2xl space-y-2.5 text-[13px] leading-relaxed text-phosphor-green/90"
          style={proseStyle}
        >
          {shownProgress.map((b) => (
            <p key={b.id} className="whitespace-pre-wrap break-words">
              {b.text}
            </p>
          ))}
          {summaryBlock && (
            <div className="mt-2 border-t border-phosphor-green/20 pt-3">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-phosphor-cyan/55">
                Summary
              </div>
              <div className="whitespace-pre-wrap break-words text-phosphor-green/95">
                {summaryBlock.text}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("h-full overflow-y-auto px-4 py-4", className)}
      role="log"
      aria-label="Agent thinking"
      aria-live="polite"
      aria-busy={isLive}
      data-live={isLive ? "true" : "false"}
      data-testid="thinking-stream"
    >
      {isLive && (
        <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 bg-crt-bg/90 py-1 text-[11px] text-phosphor-amber backdrop-blur-sm">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-amber" />
          Thinking live…
          <span className="font-mono text-phosphor-amber/50">
            {shownProgress.length}
          </span>
        </div>
      )}
      <div
        className="relative mx-auto max-w-2xl text-[13.5px] leading-[1.7] text-phosphor-green/90"
        style={{
          ...proseStyle,
          height: virtualizer.getTotalSize() + (summaryBlock ? 120 : 0),
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const b = shownProgress[row.index];
          if (!b) return null;
          return (
            <p
              key={b.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full whitespace-pre-wrap break-words pb-4"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {b.text}
            </p>
          );
        })}
      </div>
      {summaryBlock && (
        <div className="mx-auto mt-2 max-w-2xl border-t border-phosphor-green/20 pt-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-phosphor-cyan/55">
            Summary
          </div>
          <div
            className="whitespace-pre-wrap break-words text-phosphor-green/95"
            style={proseStyle}
          >
            {summaryBlock.text}
          </div>
        </div>
      )}
    </div>
  );
}
