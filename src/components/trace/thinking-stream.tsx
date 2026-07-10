"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSpokStore } from "@/lib/store";
import { collectThoughtBlocks } from "@/lib/trace-text";
import {
  extractSubagentLanes,
  isSubagentPollutingNode,
} from "@/lib/automation/subagent-lanes";
import { cn } from "@/lib/utils";

/**
 * Permanent thinking / progress feed.
 *
 * Each status update ("Reading the roadmap…", "The user wants…") stays on
 * screen as its own paragraph. Technical CLI noise is excluded. A final
 * formatted summary appears at the end when present.
 */
type ThinkingStreamProps = {
  /** Compact pane for embedding under the mobile prompt tab */
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
  const eventLog = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.eventLog : undefined
  );
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

  const bottomRef = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => {
    const raw = collectThoughtBlocks(nodes, eventLog);
    if (!hideSubagent || !nodes) return raw;
    const lanes = extractSubagentLanes(nodes);
    if (!lanes.length) return raw;
    // Drop blocks whose source node is subagent-lane noise
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

  const fingerprint = blocks.map((b) => `${b.id}:${b.text.length}`).join("|");

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [fingerprint, autoScroll, status]);

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

  const shownProgress = compact ? progressBlocks.slice(-12) : progressBlocks;

  return (
    <div
      className={cn(
        "overflow-y-auto px-4 py-4",
        compact ? "max-h-56 min-h-[10rem]" : "h-full",
        className
      )}
      role="log"
      aria-label="Agent thinking"
      aria-live="polite"
      aria-busy={isLive}
      data-live={isLive ? "true" : "false"}
    >
      {isLive && (
        <div className="sticky top-0 z-10 mb-3 flex items-center gap-2 bg-crt-bg/90 py-1 text-[11px] text-phosphor-amber backdrop-blur-sm">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-amber" />
          Thinking live…
        </div>
      )}
      <div
        className={cn(
          "mx-auto max-w-2xl space-y-4 text-phosphor-green/90",
          compact
            ? "space-y-2.5 text-[13px] leading-relaxed"
            : "text-[13.5px] leading-[1.7]"
        )}
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {shownProgress.map((b) => (
          <p key={b.id} className="whitespace-pre-wrap break-words">
            {b.text}
          </p>
        ))}

        {summaryBlock && (
          <div className="mt-2 border-t border-phosphor-green/20 pt-4">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-phosphor-cyan/55">
              Summary
            </div>
            <div className="whitespace-pre-wrap break-words text-phosphor-green/95">
              {summaryBlock.text}
            </div>
          </div>
        )}
      </div>
      <div ref={bottomRef} className="h-2" />
    </div>
  );
}
