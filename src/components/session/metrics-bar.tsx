"use client";

import { useEffect, useState } from "react";
import { useSpokStore } from "@/lib/store";
import { formatDuration } from "@/lib/utils";
import { GitStatusPill } from "@/components/git/git-status-pill";
import { UsageMeter } from "@/components/session/usage-meter";
import { getCachedSettings } from "@/lib/settings-client";
import {
  Wrench,
  Brain,
  FileCode2,
  Bot,
  AlertTriangle,
  Clock,
  MessageSquare,
} from "lucide-react";
import { DiffStatChip } from "@/components/diff/monaco-diff";

export function MetricsBar() {
  // Field-level selectors so thinking tokens don't re-render the bar every chunk.
  const hasSession = useSpokStore((s) => !!s.activeSessionId && !!s.sessions[s.activeSessionId!]);
  const status = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.status : undefined
  );
  // Primitive fingerprint so identical counts keep the same selector result.
  const metricsKey = useSpokStore((s) => {
    const m = s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.metrics
      : undefined;
    if (!m) return "";
    return [
      m.startedAt,
      m.endedAt,
      m.thinkingSteps,
      m.toolCallCount,
      m.filesChanged,
      m.subagentCount,
      m.errorCount,
      m.linesAdded,
      m.linesDeleted,
      m.tokensEstimate,
    ].join(":");
  });
  // Read metrics by key so Object.is on the fingerprint gates re-renders.
  const metrics = (() => {
    if (!metricsKey) return undefined;
    const id = useSpokStore.getState().activeSessionId;
    return id ? useSpokStore.getState().sessions[id]?.metrics : undefined;
  })();
  const createdAt = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.createdAt : undefined
  );
  const eventCount = useSpokStore((s) => {
    const sess = s.activeSessionId
      ? s.sessions[s.activeSessionId]
      : null;
    return sess?.eventCount ?? 0;
  });
  const reviewCount = useSpokStore((s) => {
    const comments = s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.reviewComments
      : undefined;
    if (!comments?.length) return 0;
    let n = 0;
    for (const c of comments) if (!c.resolved) n++;
    return n;
  });
  const source = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.source : undefined
  );
  const isolationGuard = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.config.isolationGuard
      : undefined
  );
  const gitSummary = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.gitSummary : undefined
  );
  const cwd = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.config.cwd : undefined
  );
  const name = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.name : undefined
  );
  const [, tick] = useState(0);

  useEffect(() => {
    if (status !== "running" && status !== "starting") return;
    // 1s is enough for the elapsed clock; 500ms was pure re-render tax.
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  if (!hasSession || !metrics) {
    return (
      <div className="flex h-8 items-center gap-4 border-b border-phosphor-green/15 px-3 text-[11px] text-phosphor-green/35">
        <span>No session</span>
      </div>
    );
  }

  const m = metrics;
  const elapsed =
    status === "running" || status === "starting"
      ? Date.now() - (m.startedAt ?? createdAt ?? Date.now())
      : m.elapsedMs;

  const ui = getCachedSettings()?.resolved.ui;
  const showUsage = ui?.showUsageMeter !== false;
  const contextLimit = ui?.contextLimitTokens;

  const items = [
    { icon: Clock, label: formatDuration(elapsed), tip: "Elapsed" },
    { icon: Brain, label: String(m.thinkingSteps), tip: "Thinking steps" },
    { icon: Wrench, label: String(m.toolCallCount), tip: "Tool calls" },
    { icon: FileCode2, label: String(m.filesChanged), tip: "Files changed" },
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
      <StatusPill status={status ?? "idle"} />
      <UsageMeter
        compact
        show={showUsage}
        contextLimit={contextLimit}
      />
      {source === "resume" && (
        <span
          title="Restored from durable session log"
          className="rounded border border-phosphor-cyan/30 bg-phosphor-cyan/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-phosphor-cyan"
        >
          restored
        </span>
      )}
      {isolationGuard && (
        <span
          title="Worktree isolation: writes to main checkout are blocked"
          className="rounded border border-phosphor-magenta/35 bg-phosphor-magenta/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-phosphor-magenta"
        >
          isolated
        </span>
      )}
      <GitStatusPill summary={gitSummary} cwd={cwd} compact />
      <DiffStatChip additions={m.linesAdded} deletions={m.linesDeleted} />
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
      {reviewCount > 0 && (
        <span
          title="Open review comments"
          className="inline-flex items-center gap-1 text-phosphor-magenta/80"
        >
          <MessageSquare className="h-3 w-3" />
          <span className="font-mono">{reviewCount}</span>
        </span>
      )}
      {eventCount > 0 && (
        <span
          title="Normalized events in log"
          className="font-mono text-phosphor-green/40"
        >
          {eventCount} evt
        </span>
      )}
      <span className="ml-auto truncate font-mono text-phosphor-green/40">
        {name}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-phosphor-green/20 text-phosphor-green border-phosphor-green/40",
    starting: "bg-phosphor-amber/20 text-phosphor-amber border-phosphor-amber/40 animate-pulse",
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
