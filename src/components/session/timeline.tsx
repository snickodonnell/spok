"use client";

import { useMemo } from "react";
import { useSpokStore } from "@/lib/store";
import { cn, formatDuration } from "@/lib/utils";
import type { TraceNodeType } from "@/lib/types";

const TYPE_COLORS: Partial<Record<TraceNodeType, string>> = {
  thinking: "bg-phosphor-cyan",
  reasoning: "bg-phosphor-cyan",
  tool_call: "bg-phosphor-amber",
  tool_result: "bg-phosphor-green-dim",
  file_change: "bg-phosphor-green",
  plan: "bg-phosphor-magenta",
  subagent: "bg-phosphor-cyan",
  error: "bg-phosphor-red",
  goal: "bg-phosphor-amber",
  message: "bg-phosphor-green/40",
};

export function Timeline() {
  const sessionId = useSpokStore((s) => s.activeSessionId);
  // Rebuild markers when node count / last node id changes — not every token.
  const nodesRevision = useSpokStore((s) => {
    const sess = s.activeSessionId
      ? s.sessions[s.activeSessionId]
      : null;
    if (!sess) return "";
    const ids = sess.rootTraceIds;
    const lastRoot = ids[ids.length - 1];
    const nodeCount = Object.keys(sess.nodes).length;
    return `${nodeCount}:${lastRoot ?? ""}:${sess.metrics.toolCallCount}`;
  });
  const selectedTraceId = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.selectedTraceId
      : null
  );
  const timelineCursor = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.timelineCursor
      : null
  );
  const elapsedMs = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.metrics.elapsedMs
      : 0
  );
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const setTimelineCursor = useSpokStore((s) => s.setTimelineCursor);

  const { nodes, minT, span, total } = useMemo(() => {
    if (!sessionId) return { nodes: [], minT: 0, span: 1, total: 0 };
    void nodesRevision;
    const session = useSpokStore.getState().sessions[sessionId];
    if (!session) return { nodes: [], minT: 0, span: 1, total: 0 };
    const list = Object.values(session.nodes).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    if (list.length === 0) return { nodes: [], minT: 0, span: 1, total: 0 };
    const minT = list[0].timestamp;
    const maxT = Math.max(list[list.length - 1].timestamp, minT + 1);
    // Cap DOM markers — 2k+ absolute buttons freezes the main thread.
    const MAX_MARKERS = 200;
    let markers = list;
    if (list.length > MAX_MARKERS) {
      const step = Math.ceil(list.length / MAX_MARKERS);
      markers = [];
      for (let i = 0; i < list.length; i += step) markers.push(list[i]);
      const last = list[list.length - 1];
      if (markers[markers.length - 1]?.id !== last.id) markers.push(last);
    }
    return { nodes: markers, minT, span: maxT - minT, total: list.length };
  }, [sessionId, nodesRevision]);

  if (!sessionId || nodes.length === 0) {
    return (
      <div className="flex h-10 items-center px-3 text-[10px] text-phosphor-green/30">
        Timeline idle
      </div>
    );
  }

  return (
    <div className="border-t border-phosphor-green/15 bg-black/30 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-phosphor-green/40">
        <span className="uppercase tracking-widest">Timeline</span>
        <span className="font-mono">
          {formatDuration(elapsedMs ?? 0)} · {total} events
        </span>
      </div>
      <div
        className="timeline-track relative h-6 cursor-pointer rounded border border-phosphor-green/15"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const ts = minT + pct * span;
          setTimelineCursor(ts);
          // select nearest node
          let best = nodes[0];
          let bestDist = Math.abs(nodes[0].timestamp - ts);
          for (const n of nodes) {
            const d = Math.abs(n.timestamp - ts);
            if (d < bestDist) {
              best = n;
              bestDist = d;
            }
          }
          selectTrace(best.id);
        }}
      >
        {nodes.map((n) => {
          const left = ((n.timestamp - minT) / span) * 100;
          const selected = selectedTraceId === n.id;
          return (
            <button
              key={n.id}
              type="button"
              title={n.title}
              className={cn(
                "absolute top-1 h-4 w-1.5 -translate-x-1/2 rounded-sm transition-transform hover:scale-y-125",
                TYPE_COLORS[n.type] ?? "bg-phosphor-green/50",
                selected && "ring-1 ring-white scale-y-150 z-10"
              )}
              style={{ left: `${left}%` }}
              onClick={(e) => {
                e.stopPropagation();
                selectTrace(n.id);
                setTimelineCursor(n.timestamp);
              }}
            />
          );
        })}
        {timelineCursor != null && (
          <div
            className="pointer-events-none absolute top-0 h-full w-px bg-phosphor-amber shadow-[0_0_6px_#ffb000]"
            style={{
              left: `${((timelineCursor - minT) / span) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
