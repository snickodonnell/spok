"use client";

import { useMemo } from "react";
import { useSpokStore } from "@/lib/store";
import {
  extractSubagentLanes,
  mergeSubagentSummaries,
} from "@/lib/automation/subagent-lanes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Layers, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact subagent lane strip for the workspace — keeps parallel work visible
 * without polluting the Thinking panel.
 */
export function SubagentLanesStrip() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selected = useSpokStore((s) => s.selectedSubagentLaneId);
  const setSelected = useSpokStore((s) => s.setSelectedSubagentLaneId);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setSessionLanes = useSpokStore((s) => s.setSessionSubagentLanes);

  const lanes = useMemo(() => {
    if (!session) return [];
    const extracted = extractSubagentLanes(session.nodes);
    // Refresh cache when node set grows
    if (
      extracted.length &&
      (!session.subagentLanes ||
        session.subagentLanes.length !== extracted.length)
    ) {
      // Defer store write
      queueMicrotask(() => {
        if (session) setSessionLanes(session.id, extracted);
      });
    }
    return extracted;
  }, [session, setSessionLanes]);

  if (!session || lanes.length === 0) return null;

  const running = lanes.filter(
    (l) => l.status === "running" || l.status === "pending"
  ).length;

  return (
    <div className="border-b border-phosphor-magenta/20 bg-phosphor-magenta/5 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <Bot className="h-3 w-3 text-phosphor-magenta/80" />
        <span className="text-[9px] uppercase tracking-widest text-phosphor-magenta/70">
          Subagent lanes
        </span>
        <Badge variant="magenta" className="text-[8px]">
          {lanes.length}
        </Badge>
        {running > 0 && (
          <span className="inline-flex items-center gap-1 text-[9px] text-phosphor-amber">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {running} active
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 gap-1 px-1.5 text-[9px] text-phosphor-magenta/70"
          onClick={() => setMonitorOpen(true)}
        >
          <Layers className="h-3 w-3" />
          Monitor
        </Button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {lanes.map((lane) => (
          <button
            key={lane.id}
            type="button"
            title={lane.summary || lane.label}
            onClick={() =>
              setSelected(selected === lane.id ? null : lane.id)
            }
            className={cn(
              "inline-flex max-w-[180px] shrink-0 items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] transition",
              selected === lane.id
                ? "border-phosphor-magenta/50 bg-phosphor-magenta/15 text-phosphor-magenta"
                : "border-phosphor-green/20 text-phosphor-green/65 hover:border-phosphor-magenta/30"
            )}
          >
            {lane.status === "running" || lane.status === "pending" ? (
              <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
            ) : lane.status === "success" ? (
              <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-phosphor-green" />
            ) : lane.status === "error" ? (
              <XCircle className="h-2.5 w-2.5 shrink-0 text-red-400" />
            ) : (
              <Bot className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className="truncate">{lane.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="mt-1.5 max-h-24 overflow-auto rounded border border-phosphor-magenta/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-phosphor-green/60">
          {lanes.find((l) => l.id === selected)?.summary ||
            mergeSubagentSummaries(lanes.filter((l) => l.id === selected))}
        </div>
      )}
    </div>
  );
}
