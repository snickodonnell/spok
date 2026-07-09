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
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
        <div className="mb-1 px-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
          Sessions
        </div>
        <ScrollArea className="flex-1">
          {list.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-phosphor-green/30">
              No sessions yet
            </p>
          ) : (
            list.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group mb-0.5 flex items-center gap-1 rounded px-1.5 py-1.5 text-xs",
                  activeSessionId === s.id
                    ? "bg-phosphor-green/12 text-phosphor-green"
                    : "text-phosphor-green/55 hover:bg-phosphor-green/5"
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setActiveSession(s.id)}
                >
                  <Circle
                    className={cn(
                      "h-2 w-2 shrink-0 fill-current",
                      s.status === "running"
                        ? "text-phosphor-green"
                        : s.status === "error"
                          ? "text-phosphor-red"
                          : "text-phosphor-green/30"
                    )}
                  />
                  <span className="truncate">{s.name}</span>
                </button>
                <button
                  type="button"
                  className="hidden shrink-0 rounded p-0.5 text-phosphor-red/70 hover:bg-red-500/10 group-hover:block"
                  onClick={() => deleteSession(s.id)}
                  title="Delete session"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      <div className="border-t border-phosphor-green/15 p-2 text-[9px] text-phosphor-green/30">
        Spok · Grok Build harness
      </div>
    </aside>
  );
}
