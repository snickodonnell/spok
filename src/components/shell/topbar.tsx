"use client";

import {
  PanelLeft,
  Command,
  Monitor,
  Play,
  Upload,
  Download,
  Settings,
  Shield,
  Puzzle,
  Layers,
  Bell,
  Keyboard,
  Palette,
} from "lucide-react";
import type { UiTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSpokStore } from "@/lib/store";
import { buildExportPayload } from "@/lib/export-session";
import { toast } from "sonner";
import { unreadCount } from "@/lib/automation/notifications";

export function Topbar() {
  const sidebarOpen = useSpokStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSpokStore((s) => s.setSidebarOpen);
  const setCommandPaletteOpen = useSpokStore((s) => s.setCommandPaletteOpen);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setExtensionsOpen = useSpokStore((s) => s.setExtensionsOpen);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setNotificationsOpen = useSpokStore((s) => s.setNotificationsOpen);
  const notifications = useSpokStore((s) => s.notifications);
  const automationJobs = useSpokStore((s) => s.automationJobs);
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const unread = unreadCount(notifications);
  const activeJobs = automationJobs.filter((j) =>
    ["queued", "running", "waiting_approval"].includes(j.status)
  ).length;
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const uiTheme = useSpokStore((s) => s.uiTheme);
  const setUiTheme = useSpokStore((s) => s.setUiTheme);
  const setKeyboardHelpOpen = useSpokStore((s) => s.setKeyboardHelpOpen);
  const exportActiveSession = useSpokStore((s) => s.exportActiveSession);
  const viewMode = useSpokStore((s) => s.viewMode);

  const cycleTheme = () => {
    const order: UiTheme[] = ["professional", "crt", "high-contrast"];
    const i = order.indexOf(uiTheme);
    const next = order[(i + 1) % order.length];
    setUiTheme(next);
    toast.message(
      next === "professional"
        ? "Professional theme"
        : next === "crt"
          ? "CRT phosphor theme"
          : "High contrast theme"
    );
  };

  const exportSession = () => {
    const session = exportActiveSession();
    if (!session) {
      toast.error("No active session");
      return;
    }
    const blob = new Blob(
      [JSON.stringify(buildExportPayload(session), null, 2)],
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
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="ml-2 inline-flex items-center gap-1 rounded border border-phosphor-green/20 px-1.5 py-0.5 transition hover:border-phosphor-cyan/40 hover:bg-phosphor-cyan/5"
          title="Permission mode — open settings"
        >
          <Shield className="h-3 w-3 text-phosphor-cyan/80" />
          <Badge
            variant={
              appPermissionMode === "bypass"
                ? "error"
                : appPermissionMode === "manual" || appPermissionMode === "plan"
                  ? "cyan"
                  : "amber"
            }
            className="h-4 px-1 text-[8px]"
          >
            {appPermissionMode}
          </Badge>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setLaunchOpen(true)}>
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Open repo</span>
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
          className="relative h-8 w-8"
          onClick={() => setMonitorOpen(true)}
          title="Monitor — background jobs, schedules, lanes"
        >
          <Layers className="h-4 w-4" />
          {activeJobs > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-phosphor-amber px-0.5 text-[8px] font-bold text-black">
              {activeJobs}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          onClick={() => setNotificationsOpen(true)}
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-phosphor-cyan px-0.5 text-[8px] font-bold text-black">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setExtensionsOpen(true)}
          title="Extension Center — skills, MCP, hooks, agents"
        >
          <Puzzle className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSettingsOpen(true)}
          title="Settings & permissions"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={cycleTheme}
          title={`Theme: ${uiTheme} (click to cycle)`}
        >
          <Palette className="h-4 w-4 text-phosphor-cyan" />
        </Button>
        {uiTheme === "crt" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setCrtEnabled(!crtEnabled);
              if (crtEnabled) setScanlines(false);
              else setScanlines(true);
            }}
            title="Toggle CRT effects"
          >
            <Monitor
              className={
                crtEnabled ? "h-4 w-4 text-phosphor-green" : "h-4 w-4 opacity-50"
              }
            />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setKeyboardHelpOpen(true)}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="h-4 w-4" />
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
