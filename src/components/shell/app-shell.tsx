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
import { SettingsDialog } from "./settings-dialog";
import { ExtensionsDialog } from "./extensions-dialog";
import { KeyboardHelpDialog } from "./keyboard-help";
import { DiagnosticsDialog } from "./diagnostics-dialog";
import { ErrorBoundary } from "./error-boundary";
import { MonitorPanel } from "@/components/automation/monitor-panel";
import { NotificationsDrawer } from "@/components/automation/notifications-drawer";
import { ApprovalOverlay } from "./approval-overlay";
import { startScheduleTicker, ensureQueuePump } from "@/lib/background-runner";
import { MetricsBar } from "@/components/session/metrics-bar";
import { StatusLine } from "@/components/session/status-line";
import { Timeline } from "@/components/session/timeline";
import { TracePanel } from "@/components/trace/trace-panel";
import { DiffPanel } from "@/components/diff/diff-panel";
import { LogPanel } from "@/components/session/log-panel";
import { OverviewPanel } from "@/components/session/overview-panel";
import { Workspace } from "@/components/session/workspace";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WelcomeScreen } from "./welcome-screen";
import { cn } from "@/lib/utils";
import { useGitWatch } from "@/hooks/use-git-watch";
import { useSessionHydration } from "@/hooks/use-session-hydration";
import { useThemeSync } from "@/hooks/use-theme";
import { resolveThemeEffects } from "@/lib/theme";
import type { ViewMode } from "@/lib/types";
import { Loader2 } from "lucide-react";

export function AppShell() {
  const viewMode = useSpokStore((s) => s.viewMode);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const sessions = useSpokStore((s) => s.sessions);
  const scanlines = useSpokStore((s) => s.scanlines);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const uiTheme = useSpokStore((s) => s.uiTheme);
  const reducedMotion = useSpokStore((s) => s.reducedMotion);
  const hydrating = useSpokStore((s) => s.hydrating);
  const hydrated = useSpokStore((s) => s.hydrated);
  const activeSession = activeSessionId ? sessions[activeSessionId] : null;

  useSessionHydration();
  useThemeSync();

  const themeFx = resolveThemeEffects({
    theme: uiTheme,
    crtEnabled,
    scanlines,
    reducedMotion,
  });

  // Phase 5: schedule ticker + background queue pump
  useEffect(() => {
    const stop = startScheduleTicker();
    ensureQueuePump();
    return stop;
  }, []);

  const automationJobs = useSpokStore((s) => s.automationJobs);
  useEffect(() => {
    ensureQueuePump();
  }, [automationJobs]);

  // Only poll git while a harness run is in progress (not on idle/ready workspace).
  // End-of-run refresh is handled once in runHarness; manual refresh is on Diff panel.
  useGitWatch(
    activeSession?.config.cwd || undefined,
    !!activeSession &&
      !!activeSession.config.cwd &&
      (activeSession.status === "running" || activeSession.status === "starting")
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLOptionElement)
        return;
      // ContentEditable / role=textbox
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || e.target.getAttribute("role") === "textbox")
      )
        return;

      const map: Record<string, ViewMode> = {
        "1": "workspace",
        "2": "trace",
        "3": "diff",
        "4": "overview",
        "5": "log",
      };
      if ((e.metaKey || e.ctrlKey) && map[e.key]) {
        e.preventDefault();
        useSpokStore.getState().setViewMode(map[e.key]);
      }
      // ? opens keyboard help when not shifted into other shortcuts
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        useSpokStore.getState().setKeyboardHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasSessions = Object.keys(sessions).length > 0;
  const showWelcome = hydrated && !activeSessionId && !hasSessions;

  function renderMain() {
    if (hydrating && !hasSessions) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-phosphor-green/60">
          <Loader2 className="h-6 w-6 animate-spin text-phosphor-cyan" />
          <div className="font-mono text-xs uppercase tracking-[0.2em]">
            Restoring sessions…
          </div>
          <p className="max-w-sm text-center text-[11px] text-phosphor-green/35">
            Loading durable logs from disk so you can continue where you left off.
          </p>
        </div>
      );
    }
    if (showWelcome) return <WelcomeScreen />;
    switch (viewMode) {
      case "workspace":
        return <Workspace />;
      case "unified":
        return (
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
        );
      case "trace":
        return <TracePanel />;
      case "diff":
        return <DiffPanel />;
      case "log":
        return <LogPanel />;
      case "overview":
      default:
        return <OverviewPanel />;
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex h-screen w-screen flex-col overflow-hidden bg-crt-bg text-phosphor-green",
          themeFx.crtEffects && "crt-flicker",
          themeFx.scanlines && "crt-scanlines"
        )}
      >
        <a href="#spok-main" className="skip-link">
          Skip to main content
        </a>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <MetricsBar />
            <StatusLine />
            <main id="spok-main" className="min-h-0 flex-1" tabIndex={-1}>
              <ErrorBoundary name="main">
                {renderMain()}
              </ErrorBoundary>
            </main>
            {!showWelcome && <Timeline />}
          </div>
        </div>
        <CommandPalette />
        <LaunchDialog />
        <ImportDialog />
        <SettingsDialog />
        <ExtensionsDialog />
        <KeyboardHelpDialog />
        <DiagnosticsDialog />
        <MonitorPanel />
        <NotificationsDrawer />
        <ApprovalOverlay />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className: "spok-toast",
            style: {
              background: "var(--crt-panel)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
            },
          }}
        />
      </div>
    </TooltipProvider>
  );
}
