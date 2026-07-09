"use client";

import { useEffect, useState } from "react";
import { useSpokStore } from "@/lib/store";
import { formatDuration } from "@/lib/utils";
import {
  Wrench,
  Brain,
  FileCode2,
  Bot,
  AlertTriangle,
  Clock,
  Plus,
  Minus,
} from "lucide-react";

export function MetricsBar() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const [, tick] = useState(0);

  useEffect(() => {
    if (!session || (session.status !== "running" && session.status !== "starting"))
      return;
    const id = setInterval(() => tick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [session]);

  if (!session) {
    return (
      <div className="flex h-8 items-center gap-4 border-b border-phosphor-green/15 px-3 text-[11px] text-phosphor-green/35">
        <span>No session</span>
      </div>
    );
  }

  const m = session.metrics;
  const elapsed =
    session.status === "running" || session.status === "starting"
      ? Date.now() - (m.startedAt ?? session.createdAt)
      : m.elapsedMs;

  const eventCount = session.eventCount ?? session.eventLog?.length ?? 0;

  const items = [
    { icon: Clock, label: formatDuration(elapsed), tip: "Elapsed" },
    { icon: Brain, label: String(m.thinkingSteps), tip: "Thinking steps" },
    { icon: Wrench, label: String(m.toolCallCount), tip: "Tool calls" },
    { icon: FileCode2, label: String(m.filesChanged), tip: "Files changed" },
    { icon: Plus, label: String(m.linesAdded), tip: "Lines added", className: "text-phosphor-green" },
    { icon: Minus, label: String(m.linesDeleted), tip: "Lines deleted", className: "text-phosphor-red" },
    { icon: Bot, label: String(m.subagentCount), tip: "Subagents" },
    {
      icon: AlertTriangle,
      label: String(m.errorCount),
      tip: "Errors",
      className: m.errorCount ? "text-phosphor-red" : undefined,
    },
  ];

  return (
    <div className="flex h-8 items-center gap-3 overflow-x-auto border-b border-phosphor-green/15 px-3 text-[11px]">
      <StatusPill status={session.status} />
      {session.source === "resume" && (
        <span
          title="Restored from durable session log"
          className="rounded border border-phosphor-cyan/30 bg-phosphor-cyan/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-phosphor-cyan"
        >
          restored
        </span>
      )}
      {items.map((item) => (
        <span
          key={item.tip}
          title={item.tip}
          className={`inline-flex items-center gap-1 text-phosphor-green/70 ${item.className ?? ""}`}
        >
          <item.icon className="h-3 w-3 opacity-70" />
          <span className="font-mono">{item.label}</span>
        </span>
      ))}
      {eventCount > 0 && (
        <span
          title="Normalized events in log"
          className="font-mono text-phosphor-green/40"
        >
          {eventCount} evt
        </span>
      )}
      <span className="ml-auto truncate font-mono text-phosphor-green/40">
        {session.name}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-phosphor-green/20 text-phosphor-green border-phosphor-green/40",
    starting: "bg-phosphor-amber/20 text-phosphor-amber border-phosphor-amber/40",
    ready: "bg-phosphor-cyan/15 text-phosphor-cyan border-phosphor-cyan/30",
    completed: "bg-phosphor-cyan/15 text-phosphor-cyan border-phosphor-cyan/30",
    error: "bg-red-500/15 text-red-400 border-red-500/40",
    stopped: "bg-white/5 text-white/50 border-white/15",
    paused: "bg-phosphor-amber/15 text-phosphor-amber border-phosphor-amber/30",
    idle: "bg-white/5 text-white/40 border-white/10",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${map[status] ?? map.idle}`}
    >
      {(status === "running" || status === "starting") && (
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-green" />
      )}
      {status}
    </span>
  );
}
