"use client";

import {
  PanelLeft,
  Command,
  Monitor,
  Play,
  Upload,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpokStore } from "@/lib/store";
import { toast } from "sonner";

export function Topbar() {
  const sidebarOpen = useSpokStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSpokStore((s) => s.setSidebarOpen);
  const setCommandPaletteOpen = useSpokStore((s) => s.setCommandPaletteOpen);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const exportActiveSession = useSpokStore((s) => s.exportActiveSession);
  const viewMode = useSpokStore((s) => s.viewMode);

  const exportSession = () => {
    const session = exportActiveSession();
    if (!session) {
      toast.error("No active session");
      return;
    }
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: Date.now(), session }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spok-session-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-phosphor-green/15 bg-crt-panel px-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="hidden items-center gap-1 sm:flex">
        <span className="font-mono text-xs tracking-[0.25em] text-phosphor-green/80 crt-glow">
          SPOK
        </span>
        <span className="text-phosphor-green/25" aria-hidden>
          {"//"}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-phosphor-cyan/70">
          {viewMode}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setLaunchOpen(true)}>
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Launch</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={exportSession}>
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setCrtEnabled(!crtEnabled);
            if (crtEnabled) setScanlines(false);
            else setScanlines(true);
          }}
          title="Toggle CRT theme effects"
        >
          <Monitor className={crtEnabled ? "h-4 w-4 text-phosphor-green" : "h-4 w-4 opacity-50"} />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Ctrl+K</span>
        </Button>
      </div>
    </header>
  );
}
