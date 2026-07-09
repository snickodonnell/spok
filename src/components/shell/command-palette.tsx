"use client";

import { useEffect, useState, type ComponentType } from "react";
import { Command } from "cmdk";
import { useSpokStore } from "@/lib/store";
import {
  Play,
  Upload,
  Download,
  LayoutGrid,
  Brain,
  FileCode2,
  ScrollText,
  BarChart3,
  Sparkles,
  Monitor,
  Keyboard,
} from "lucide-react";
import { SAMPLES } from "@/lib/samples";
import { playEvents } from "@/lib/playback";
import { toast } from "sonner";

export function CommandPalette() {
  const open = useSpokStore((s) => s.commandPaletteOpen);
  const setOpen = useSpokStore((s) => s.setCommandPaletteOpen);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);
  const exportActiveSession = useSpokStore((s) => s.exportActiveSession);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const scanlines = useSpokStore((s) => s.scanlines);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const expandAll = useSpokStore((s) => s.expandAll);
  const collapseAll = useSpokStore((s) => s.collapseAll);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (!open) return null;

  const runSample = (sampleId: string) => {
    const sample = SAMPLES.find((s) => s.meta.id === sampleId);
    if (!sample) return;
    const id = createSession({
      name: sample.meta.name,
      source: "sample",
      status: "running",
    });
    setOpen(false);
    toast.message(`Playing sample: ${sample.meta.name}`);
    playEvents(
      sample.events,
      (ev) => {
        applyStreamEvent(id, ev);
        if (ev.content) appendRawLog(id, `[${ev.type}] ${ev.content.slice(0, 200)}`);
      },
      {
        speed: 1.5,
        onComplete: () => {
          updateSession(id, { status: "completed" });
          toast.success("Sample playback complete");
        },
      }
    );
  };

  const exportSession = () => {
    const session = exportActiveSession();
    if (!session) {
      toast.error("No active session to export");
      return;
    }
    const payload = {
      version: 1 as const,
      exportedAt: Date.now(),
      session,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spok-session-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
    toast.success("Session exported");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 pt-[15vh] backdrop-blur-sm">
      <div
        className="fixed inset-0"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <Command
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-lg border border-phosphor-green/30 bg-crt-panel shadow-[0_0_40px_rgba(51,255,102,0.15)]"
        label="Command palette"
      >
        <div className="flex items-center border-b border-phosphor-green/20 px-3">
          <Keyboard className="mr-2 h-4 w-4 text-phosphor-green/50" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command or search…"
            className="h-12 w-full bg-transparent font-mono text-sm text-phosphor-green outline-none placeholder:text-phosphor-green/35"
          />
        </div>
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="py-6 text-center text-xs text-phosphor-green/40">
            No results
          </Command.Empty>

          <Command.Group
            heading="Session"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-phosphor-green/40"
          >
            <Item
              icon={Play}
              label="Open repo workspace"
              onSelect={() => {
                setOpen(false);
                setLaunchOpen(true);
              }}
            />
            <Item
              icon={Upload}
              label="Import / paste trace"
              onSelect={() => {
                setOpen(false);
                setImportOpen(true);
              }}
            />
            <Item icon={Download} label="Export active session" onSelect={exportSession} />
          </Command.Group>

          <Command.Group
            heading="Views"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-phosphor-green/40"
          >
            <Item icon={LayoutGrid} label="Workspace (prompt + live trace)" onSelect={() => { setViewMode("workspace"); setOpen(false); }} />
            <Item icon={LayoutGrid} label="Unified view" onSelect={() => { setViewMode("unified"); setOpen(false); }} />
            <Item icon={Brain} label="Trace view" onSelect={() => { setViewMode("trace"); setOpen(false); }} />
            <Item icon={FileCode2} label="Diff view" onSelect={() => { setViewMode("diff"); setOpen(false); }} />
            <Item icon={ScrollText} label="Log view" onSelect={() => { setViewMode("log"); setOpen(false); }} />
            <Item icon={BarChart3} label="Overview" onSelect={() => { setViewMode("overview"); setOpen(false); }} />
          </Command.Group>

          <Command.Group
            heading="Samples"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-phosphor-green/40"
          >
            {SAMPLES.map((s) => (
              <Item
                key={s.meta.id}
                icon={Sparkles}
                label={`Play: ${s.meta.name}`}
                onSelect={() => runSample(s.meta.id)}
              />
            ))}
          </Command.Group>

          <Command.Group
            heading="Display"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-phosphor-green/40"
          >
            <Item
              icon={Monitor}
              label={crtEnabled ? "Disable CRT effects" : "Enable CRT effects"}
              onSelect={() => {
                setCrtEnabled(!crtEnabled);
                setOpen(false);
              }}
            />
            <Item
              icon={Monitor}
              label={scanlines ? "Hide scanlines" : "Show scanlines"}
              onSelect={() => {
                setScanlines(!scanlines);
                setOpen(false);
              }}
            />
            <Item icon={Brain} label="Expand all traces" onSelect={() => { expandAll(); setOpen(false); }} />
            <Item icon={Brain} label="Collapse all traces" onSelect={() => { collapseAll(); setOpen(false); }} />
          </Command.Group>
        </Command.List>
        <div className="border-t border-phosphor-green/15 px-3 py-1.5 text-[10px] text-phosphor-green/35">
          <kbd className="rounded border border-phosphor-green/20 px-1">Ctrl</kbd>+
          <kbd className="rounded border border-phosphor-green/20 px-1">K</kbd> to toggle
        </div>
      </Command>
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-phosphor-green/80 aria-selected:bg-phosphor-green/15 aria-selected:text-phosphor-green"
    >
      <Icon className="h-4 w-4 text-phosphor-green/50" />
      {label}
    </Command.Item>
  );
}
