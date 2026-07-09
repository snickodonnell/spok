"use client";

import { useEffect } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { Toaster } from "sonner";
import { useSpokStore } from "@/lib/store";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { LaunchDialog } from "./launch-dialog";
import { ImportDialog } from "./import-dialog";
import { MetricsBar } from "@/components/session/metrics-bar";
import { Timeline } from "@/components/session/timeline";
import { TracePanel } from "@/components/trace/trace-panel";
import { DiffPanel } from "@/components/diff/diff-panel";
import { LogPanel } from "@/components/session/log-panel";
import { OverviewPanel } from "@/components/session/overview-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomeScreen } from "./welcome-screen";
import { cn } from "@/lib/utils";
import { useGitWatch } from "@/hooks/use-git-watch";

export function AppShell() {
  const viewMode = useSpokStore((s) => s.viewMode);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const sessions = useSpokStore((s) => s.sessions);
  const scanlines = useSpokStore((s) => s.scanlines);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const activeSession = activeSessionId ? sessions[activeSessionId] : null;

  useGitWatch(
    activeSession?.config.cwd || undefined,
    !!activeSession &&
      (activeSession.status === "running" || activeSession.status === "starting") &&
      !!activeSession.config.cwd
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        useSpokStore.getState().setViewMode("unified");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        useSpokStore.getState().setViewMode("trace");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "3") {
        e.preventDefault();
        useSpokStore.getState().setViewMode("diff");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "4") {
        e.preventDefault();
        useSpokStore.getState().setViewMode("overview");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasSessions = Object.keys(sessions).length > 0;
  const showWelcome = !activeSessionId && !hasSessions;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex h-screen w-screen flex-col overflow-hidden bg-crt-bg text-phosphor-green",
          crtEnabled && "crt-flicker",
          scanlines && crtEnabled && "crt-scanlines"
        )}
      >
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <MetricsBar />
            <main className="min-h-0 flex-1">
              {showWelcome ? (
                <WelcomeScreen />
              ) : viewMode === "unified" ? (
                <Group orientation="horizontal" className="h-full">
                  <Panel defaultSize={42} minSize={25}>
                    <div className="h-full border-r border-phosphor-green/10">
                      <TracePanel />
                    </div>
                  </Panel>
                  <Separator className="w-1 bg-phosphor-green/15 hover:bg-phosphor-green/40 transition-colors" />
                  <Panel defaultSize={58} minSize={30}>
                    <DiffPanel />
                  </Panel>
                </Group>
              ) : viewMode === "trace" ? (
                <TracePanel />
              ) : viewMode === "diff" ? (
                <DiffPanel />
              ) : viewMode === "log" ? (
                <LogPanel />
              ) : (
                <OverviewPanel />
              )}
            </main>
            {!showWelcome && <Timeline />}
          </div>
        </div>
        <CommandPalette />
        <LaunchDialog />
        <ImportDialog />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#0a100c",
              border: "1px solid rgba(51,255,102,0.3)",
              color: "#33ff66",
              fontFamily: "ui-monospace, monospace",
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
}
