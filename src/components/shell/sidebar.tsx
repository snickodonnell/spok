"use client";

import { useMemo } from "react";
import {
  Brain,
  FileCode2,
  LayoutGrid,
  ScrollText,
  BarChart3,
  Play,
  Upload,
  Command,
  PanelsTopLeft,
  HardDrive,
  Settings,
  Shield,
  Plus,
  Puzzle,
  Layers,
  Bell,
  Inbox,
  Rocket,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  openWorkspaceSession,
  resolveCurrentWorkspace,
} from "@/lib/workspace-session";
import {
  buildSessionInbox,
  inboxJobsFingerprint,
  inboxSessionFingerprint,
} from "@/lib/session-inbox";
import { SessionInboxPanel } from "./session-inbox";
import { performInboxJobAction } from "@/lib/inbox-actions";

/** Secondary layout views — primary product modes live in the topbar. */
const VIEWS: { mode: ViewMode; icon: typeof Brain; label: string }[] = [
  { mode: "workspace", icon: PanelsTopLeft, label: "Workspace" },
  { mode: "unified", icon: LayoutGrid, label: "Split" },
  { mode: "trace", icon: Brain, label: "Thinking" },
  { mode: "diff", icon: FileCode2, label: "Changes" },
  { mode: "log", icon: ScrollText, label: "Events" },
  { mode: "overview", icon: BarChart3, label: "Health" },
];

export function Sidebar() {
  const open = useSpokStore((s) => s.sidebarOpen);
  const viewMode = useSpokStore((s) => s.viewMode);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const setProductMode = useSpokStore((s) => s.setProductMode);

  // Fingerprint operational fields only — avoid stream-tick re-renders (tokens).
  const sessionListKey = useSpokStore((s) =>
    Object.values(s.sessions)
      .map((sess) => inboxSessionFingerprint(sess))
      .sort()
      .join("|")
  );
  const jobsKey = useSpokStore((s) => inboxJobsFingerprint(s.automationJobs));
  const maxConcurrentBackground = useSpokStore(
    (s) => s.automationMaxConcurrent
  );

  const inbox = useMemo(() => {
    void sessionListKey;
    void jobsKey;
    const state = useSpokStore.getState();
    return buildSessionInbox(state.sessions, {
      jobs: state.automationJobs,
      maxConcurrentBackground,
    });
  }, [sessionListKey, jobsKey, maxConcurrentBackground]);

  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const deleteSession = useSpokStore((s) => s.deleteSession);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const setCommandPaletteOpen = useSpokStore((s) => s.setCommandPaletteOpen);
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setExtensionsOpen = useSpokStore((s) => s.setExtensionsOpen);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setMonitorSelectedJobId = useSpokStore(
    (s) => s.setMonitorSelectedJobId
  );
  const setNotificationsOpen = useSpokStore((s) => s.setNotificationsOpen);
  const activeJobs = useSpokStore(
    (s) =>
      s.automationJobs.filter((j) =>
        ["queued", "starting", "running", "waiting_approval"].includes(j.status)
      ).length
  );
  const unreadNotes = useSpokStore(
    (s) => s.notifications.filter((n) => !n.read).length
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);

  if (!open) return null;

  const startNewSessionInWorkspace = async () => {
    const ws = resolveCurrentWorkspace();
    if (!ws) {
      toast.message("Pick a repo first", {
        description: "Open a workspace, then use + to start another session there.",
      });
      setLaunchOpen(true);
      return;
    }
    try {
      const { name } = await openWorkspaceSession({
        cwd: ws.cwd,
        command: ws.command,
      });
      toast.success(`New session · ${name}`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not start a new session"
      );
    }
  };

  return (
    <aside
      className="flex h-full w-60 shrink-0 flex-col border-r border-phosphor-green/15 bg-crt-panel"
      data-testid="app-sidebar"
    >
      <div className="border-b border-phosphor-green/15 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-phosphor-green/40 bg-phosphor-green/10 text-xs font-bold text-phosphor-green shadow-[0_0_12px_rgba(51,255,102,0.3)]">
            S
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-phosphor-green">
              SPOK
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-phosphor-green/40">
              Grok Build mission control
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1 border-b border-phosphor-green/15 p-2">
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start"
          onClick={() => setProductMode("enterprise")}
        >
          <Rocket className="h-3.5 w-3.5" />
          Missions
          <span className="ml-auto text-[9px] text-phosphor-green/60">Spok leads</span>
        </Button>
        <Button
          variant="outline"
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
          <span className="ml-auto text-[10px] text-phosphor-green/35">Ctrl+K</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setMonitorOpen(true)}
        >
          <Layers className="h-3.5 w-3.5" />
          Monitor
          {activeJobs > 0 && (
            <span className="ml-auto rounded bg-phosphor-amber/20 px-1 font-mono text-[9px] text-phosphor-amber">
              {activeJobs}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setNotificationsOpen(true)}
        >
          <Bell className="h-3.5 w-3.5" />
          Alerts
          {unreadNotes > 0 && (
            <span className="ml-auto rounded bg-phosphor-cyan/20 px-1 font-mono text-[9px] text-phosphor-cyan">
              {unreadNotes}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setExtensionsOpen(true)}
        >
          <Puzzle className="h-3.5 w-3.5" />
          Extensions
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
          <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-phosphor-cyan/60">
            <Shield className="h-2.5 w-2.5" />
            {appPermissionMode}
          </span>
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
        <div className="mb-1 flex items-center justify-between gap-1 px-1">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
            <Inbox className="h-3 w-3 opacity-70" />
            Inbox
          </span>
          <div className="flex items-center gap-0.5">
            {inbox.summary.total > 0 && (
              <span className="font-mono text-[9px] text-phosphor-green/30">
                {inbox.summary.total}
              </span>
            )}
            {inbox.summary.attentionCount > 0 && (
              <span
                className="rounded bg-phosphor-amber/20 px-1 font-mono text-[9px] text-phosphor-amber"
                title="Needs attention"
              >
                {inbox.summary.attentionCount}
              </span>
            )}
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-phosphor-green/20 text-phosphor-green/70 transition-colors hover:border-phosphor-green/40 hover:bg-phosphor-green/10 hover:text-phosphor-green"
              title="New session in current workspace"
              aria-label="New session in current workspace"
              onClick={() => void startNewSessionInWorkspace()}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <SessionInboxPanel
          inbox={inbox}
          activeSessionId={activeSessionId}
          onSelect={(id, action) => {
            setActiveSession(id);
            setViewMode(
              action.kind === "review_changes" ? "diff" : "workspace"
            );
          }}
          onOpenJob={(jobId) => {
            setMonitorSelectedJobId(jobId);
            setMonitorOpen(true);
          }}
          onDelete={(id) => deleteSession(id)}
          onJobAction={(jobId, action) => {
            const result = performInboxJobAction(jobId, action);
            if (result.ok) toast.message(result.message);
            else toast.error(result.message);
          }}
        />
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
