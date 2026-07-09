"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSpokStore } from "@/lib/store";
import { collectThoughtBlocks } from "@/lib/trace-text";
import {
  extractSubagentLanes,
  isSubagentPollutingNode,
} from "@/lib/automation/subagent-lanes";

/**
 * Permanent thinking / progress feed.
 *
 * Each status update ("Reading the roadmap…", "The user wants…") stays on
 * screen as its own paragraph. Technical CLI noise is excluded. A final
 * formatted summary appears at the end when present.
 */
export function ThinkingStream() {
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
      <div className="flex h-full items-center justify-center p-6 text-sm text-phosphor-green/35">
        No active session
      </div>
    );
  }

  if (blocks.length === 0) {
    const running =
      status === "running" || status === "starting" || status === "ready";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-phosphor-green/45">
          {running ? "Waiting for thoughts…" : "No thoughts in this session yet"}
        </p>
        <p className="max-w-xs text-[11px] leading-relaxed text-phosphor-green/28">
          Progress updates stay here permanently as the agent works. Tool calls and
          raw stream lines stay in Log.
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto px-4 py-4"
      role="log"
      aria-label="Agent thinking"
      aria-live="polite"
    >
      <div
        className="mx-auto max-w-2xl space-y-4 text-[13.5px] leading-[1.7] text-phosphor-green/90"
        style={{
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {progressBlocks.map((b) => (
          <p
            key={b.id}
            className="whitespace-pre-wrap break-words"
          >
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
