"use client";

import { useSpokStore } from "@/lib/store";
import { formatDuration } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  FileCode2,
  Brain,
  Wrench,
  Bot,
  GitCommit,
} from "lucide-react";

export function OverviewPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Start or import a session to see the overview
      </div>
    );
  }

  const m = session.metrics;
  const files = Object.values(session.files);
  const nodes = Object.values(session.nodes);
  const tools = nodes.filter((n) => n.type === "tool_call");
  const toolFreq = tools.reduce<Record<string, number>>((acc, n) => {
    const name = n.toolName || n.title;
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  const g = session.gitSummary;
  const reviewOpen =
    session.reviewComments?.filter((c) => !c.resolved).length ?? 0;

  const cards = [
    {
      icon: Activity,
      label: "Status",
      value: session.status.toUpperCase(),
      accent: "text-phosphor-green",
    },
    {
      icon: Brain,
      label: "Thinking",
      value: String(m.thinkingSteps),
      accent: "text-phosphor-cyan",
    },
    {
      icon: Wrench,
      label: "Tool calls",
      value: String(m.toolCallCount),
      accent: "text-phosphor-amber",
    },
    {
      icon: FileCode2,
      label: "Files",
      value: String(m.filesChanged),
      accent: "text-phosphor-green",
    },
    {
      icon: GitCommit,
      label: "Lines",
      value: `+${m.linesAdded} / -${m.linesDeleted}`,
      accent: "text-phosphor-magenta",
    },
    {
      icon: Bot,
      label: "Subagents",
      value: String(m.subagentCount),
      accent: "text-phosphor-cyan",
    },
    {
      icon: GitCommit,
      label: "Branch",
      value: g?.branch ?? "—",
      accent: "text-phosphor-cyan",
    },
    {
      icon: FileCode2,
      label: "Git dirty",
      value: g
        ? g.clean
          ? "clean"
          : `${g.stagedCount}S ${g.unstagedCount}M ${g.untrackedCount}?`
        : "—",
      accent: g && !g.clean ? "text-phosphor-amber" : "text-phosphor-green",
    },
    {
      icon: Activity,
      label: "Review",
      value: String(reviewOpen),
      accent: "text-phosphor-magenta",
    },
  ];

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4">
        <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-phosphor-green crt-glow">
          Session Overview
        </h2>
        <p className="mt-1 text-xs text-phosphor-green/50">{session.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-phosphor-green/35">
          Source: {session.source}
          {session.durable !== false &&
          (session.source === "live" || session.source === "resume")
            ? " · durable"
            : ""}{" "}
          · Elapsed {formatDuration(m.elapsedMs)}
          {(session.eventCount ?? session.eventLog?.length)
            ? ` · ${session.eventCount ?? session.eventLog?.length} events`
            : ""}
        </p>
        {session.config.cwd && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-phosphor-cyan/50" title={session.config.cwd}>
            {session.config.cwd}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="crt-panel rounded-lg p-4"
          >
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-phosphor-green/45">
              <c.icon className={`h-3.5 w-3.5 ${c.accent}`} />
              {c.label}
            </div>
            <div className={`mt-2 font-mono text-xl ${c.accent} crt-glow`}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="crt-panel rounded-lg p-4">
          <h3 className="mb-3 text-[10px] uppercase tracking-widest text-phosphor-green/45">
            Changed files
          </h3>
          {files.length === 0 ? (
            <p className="text-xs text-phosphor-green/35">None yet</p>
          ) : (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 font-mono text-xs text-phosphor-green/80"
                >
                  <Badge
                    variant={
                      f.status === "added"
                        ? "success"
                        : f.status === "deleted"
                          ? "error"
                          : "amber"
                    }
                  >
                    {f.status[0].toUpperCase()}
                  </Badge>
                  <span className="truncate">{f.path}</span>
                  <span className="ml-auto shrink-0">
                    <span className="text-phosphor-green">+{f.additions}</span>{" "}
                    <span className="text-phosphor-red">-{f.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="crt-panel rounded-lg p-4">
          <h3 className="mb-3 text-[10px] uppercase tracking-widest text-phosphor-green/45">
            Tool frequency
          </h3>
          {Object.keys(toolFreq).length === 0 ? (
            <p className="text-xs text-phosphor-green/35">No tools yet</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(toolFreq)
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => (
                  <li key={name} className="flex items-center gap-2 text-xs">
                    <span className="w-32 truncate font-mono text-phosphor-amber">
                      {name}
                    </span>
                    <div className="h-1.5 flex-1 rounded bg-black/50">
                      <div
                        className="h-full rounded bg-phosphor-amber/70 shadow-[0_0_6px_rgba(255,176,0,0.4)]"
                        style={{
                          width: `${(count / Math.max(...Object.values(toolFreq))) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-6 text-right font-mono text-phosphor-green/60">
                      {count}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
