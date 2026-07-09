"use client";

import {
  Brain,
  FileCode2,
  LayoutGrid,
  ScrollText,
  BarChart3,
  Play,
  Upload,
  Command,
  Trash2,
  Circle,
  PanelsTopLeft,
  HardDrive,
  History,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import type { Session, ViewMode } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

const VIEWS: { mode: ViewMode; icon: typeof Brain; label: string }[] = [
  { mode: "workspace", icon: PanelsTopLeft, label: "Workspace" },
  { mode: "unified", icon: LayoutGrid, label: "Unified" },
  { mode: "trace", icon: Brain, label: "Trace" },
  { mode: "diff", icon: FileCode2, label: "Diff" },
  { mode: "log", icon: ScrollText, label: "Log" },
  { mode: "overview", icon: BarChart3, label: "Overview" },
];

export function Sidebar() {
  const open = useSpokStore((s) => s.sidebarOpen);
  const viewMode = useSpokStore((s) => s.viewMode);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const sessions = useSpokStore((s) => s.sessions);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const deleteSession = useSpokStore((s) => s.deleteSession);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const setCommandPaletteOpen = useSpokStore((s) => s.setCommandPaletteOpen);

  if (!open) return null;

  const list = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-phosphor-green/15 bg-crt-panel">
      <div className="border-b border-phosphor-green/15 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-phosphor-green/40 bg-phosphor-green/10 text-xs font-bold text-phosphor-green shadow-[0_0_12px_rgba(51,255,102,0.3)]">
            S
          </div>
          <div>
            <div className="font-mono text-sm font-semibold tracking-wider text-phosphor-green crt-glow">
              SPOK
            </div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-phosphor-green/40">
              Live Harness
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1 border-b border-phosphor-green/15 p-2">
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start"
          onClick={() => setLaunchOpen(true)}
        >
          <Play className="h-3.5 w-3.5" />
          Open repo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => setImportOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Command className="h-3.5 w-3.5" />
          Commands
          <span className="ml-auto text-[10px] text-phosphor-green/35">⌘K</span>
        </Button>
      </div>

      <div className="border-b border-phosphor-green/15 p-2">
        <div className="mb-1 px-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
          Views
        </div>
        {VIEWS.map((v) => (
          <button
            key={v.mode}
            type="button"
            onClick={() => setViewMode(v.mode)}
            className={cn(
              "mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
              viewMode === v.mode
                ? "bg-phosphor-green/15 text-phosphor-green"
                : "text-phosphor-green/55 hover:bg-phosphor-green/5 hover:text-phosphor-green/80"
            )}
          >
            <v.icon className="h-3.5 w-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[10px] uppercase tracking-widest text-phosphor-green/40">
            Sessions
          </span>
          {list.length > 0 && (
            <span className="font-mono text-[9px] text-phosphor-green/30">
              {list.length}
            </span>
          )}
        </div>
        <ScrollArea className="flex-1">
          {list.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-phosphor-green/30">
              No sessions yet — open a repo to start. Live sessions are saved to disk
              automatically.
            </p>
          ) : (
            list.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={activeSessionId === s.id}
                onSelect={() => {
                  setActiveSession(s.id);
                  setViewMode("workspace");
                }}
                onDelete={() => deleteSession(s.id)}
              />
            ))
          )}
        </ScrollArea>
      </div>

      <div className="border-t border-phosphor-green/15 p-2 text-[9px] text-phosphor-green/30">
        <div className="flex items-center gap-1">
          <HardDrive className="h-2.5 w-2.5" />
          Durable sessions · ~/.spok/sessions
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  session: s,
  active,
  onSelect,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const sourceLabel =
    s.source === "resume"
      ? "restored"
      : s.source === "live"
        ? "live"
        : s.source === "sample"
          ? "sample"
          : s.source === "import" || s.source === "paste"
            ? "import"
            : s.source;

  const eventCount = s.eventCount ?? s.eventLog?.length ?? 0;

  return (
    <div
      className={cn(
        "group mb-1 rounded border px-1.5 py-1.5 text-xs transition-colors",
        active
          ? "border-phosphor-green/35 bg-phosphor-green/12 text-phosphor-green"
          : "border-transparent text-phosphor-green/55 hover:border-phosphor-green/15 hover:bg-phosphor-green/5"
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={onSelect}
          title={s.config.cwd || s.name}
        >
          <Circle
            className={cn(
              "h-2 w-2 shrink-0 fill-current",
              s.status === "running" || s.status === "starting"
                ? "text-phosphor-green"
                : s.status === "error"
                  ? "text-red-400"
                  : s.status === "ready"
                    ? "text-phosphor-cyan/70"
                    : "text-phosphor-green/30"
            )}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
        </button>
        <button
          type="button"
          className="hidden shrink-0 rounded p-0.5 text-phosphor-red/70 hover:bg-red-500/10 group-hover:block"
          onClick={onDelete}
          title="Delete session (also removes disk log)"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <button
        type="button"
        onClick={onSelect}
        className="mt-1 flex w-full flex-wrap items-center gap-1 pl-3.5 text-left"
      >
        <Badge
          variant={s.source === "resume" ? "cyan" : "muted"}
          className="h-4 px-1 text-[8px] uppercase"
        >
          {s.source === "resume" ? (
            <span className="inline-flex items-center gap-0.5">
              <History className="h-2 w-2" />
              {sourceLabel}
            </span>
          ) : (
            sourceLabel
          )}
        </Badge>
        {s.durable !== false && (s.source === "live" || s.source === "resume") && (
          <Badge variant="muted" className="h-4 px-1 text-[8px]">
            <HardDrive className="mr-0.5 inline h-2 w-2" />
            disk
          </Badge>
        )}
        {eventCount > 0 && (
          <span className="font-mono text-[9px] text-phosphor-green/30">
            {eventCount} evt
          </span>
        )}
        <span className="ml-auto font-mono text-[9px] text-phosphor-green/25">
          {formatRelativeTime(s.updatedAt)}
        </span>
      </button>
      {s.config.cwd && (
        <div
          className="mt-0.5 truncate pl-3.5 font-mono text-[9px] text-phosphor-green/25"
          title={s.config.cwd}
        >
          {s.config.cwd}
        </div>
      )}
    </div>
  );
}
