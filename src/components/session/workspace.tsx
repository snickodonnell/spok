"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useSpokStore } from "@/lib/store";
import { TracePanel } from "@/components/trace/trace-panel";
import { EventGraphPanel } from "@/components/trace/event-graph-panel";
import { DiffPanel } from "@/components/diff/diff-panel";
import { LogPanel } from "@/components/session/log-panel";
import { OverviewPanel } from "@/components/session/overview-panel";
import { GitPanel } from "@/components/git/git-panel";
import { GitStatusPill } from "@/components/git/git-status-pill";
import { PromptComposer } from "@/components/session/prompt-composer";
import { RunStatusCard } from "@/components/session/run-status-card";
import { SubagentLanesStrip } from "@/components/automation/subagent-lanes-strip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileCode2,
  ScrollText,
  HeartPulse,
  GitPullRequest,
  Brain,
  ListTree,
} from "lucide-react";
import type { WorkspaceRightTab } from "@/lib/types";
import { cn } from "@/lib/utils";
import { localFetch } from "@/lib/local-api-client";

/**
 * Primary live harness surface (Horizon 1 product coherence):
 * - Run status card (cwd, branch, permission, CLI, dirty, stop)
 * - Left: Thinking feed or Event graph
 * - Right: Changes / Review / Events / Health
 * - Composer cockpit docked at bottom
 */
export function Workspace() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const rightTab = useSpokStore((s) => s.workspaceRightTab);
  const setRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const leftMode = useSpokStore((s) => s.leftTraceMode);
  const setLeftMode = useSpokStore((s) => s.setLeftTraceMode);
  const updateSession = useSpokStore((s) => s.updateSession);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Open a workspace to start
      </div>
    );
  }

  const dirtyCount = session.gitSummary
    ? session.gitSummary.stagedCount +
      session.gitSummary.unstagedCount +
      session.gitSummary.untrackedCount
    : Object.keys(session.files).length;

  const stopRun = async () => {
    await localFetch(
      `/api/session/start?sessionId=${encodeURIComponent(session.id)}`,
      { method: "DELETE" }
    ).catch(() => undefined);
    updateSession(session.id, { status: "stopped" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workspace">
      <RunStatusCard onStop={() => void stopRun()} />
      <SubagentLanesStrip />
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize={40} minSize={22}>
          <div className="flex h-full min-h-0 flex-col border-r border-phosphor-green/10">
            <div
              className="flex shrink-0 items-center gap-1 border-b border-phosphor-green/15 px-2 py-1"
              role="tablist"
              aria-label="Left panel mode"
            >
              <LeftModeButton
                active={leftMode === "thinking"}
                onClick={() => setLeftMode("thinking")}
                icon={Brain}
                label="Thinking"
              />
              <LeftModeButton
                active={leftMode === "events"}
                onClick={() => setLeftMode("events")}
                icon={ListTree}
                label="Events"
              />
            </div>
            <div className="min-h-0 flex-1">
              {leftMode === "thinking" ? <TracePanel /> : <EventGraphPanel />}
            </div>
          </div>
        </Panel>
        <Separator className="w-1 bg-phosphor-green/15 hover:bg-phosphor-green/40 transition-colors" />
        <Panel defaultSize={60} minSize={30}>
          <div className="flex h-full min-h-0 flex-col">
            <Tabs
              value={rightTab}
              onValueChange={(v) => setRightTab(v as WorkspaceRightTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-2 border-b border-phosphor-green/15 px-2 py-1">
                <TabsList className="h-8">
                  <TabsTrigger value="changes" className="gap-1 text-[10px]">
                    <FileCode2 className="h-3 w-3" />
                    Changes
                    {dirtyCount > 0 && (
                      <span className="ml-0.5 rounded bg-phosphor-amber/20 px-1 font-mono text-[9px] text-phosphor-amber">
                        {dirtyCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="review" className="gap-1 text-[10px]">
                    <GitPullRequest className="h-3 w-3" />
                    Review
                  </TabsTrigger>
                  <TabsTrigger value="events" className="gap-1 text-[10px]">
                    <ScrollText className="h-3 w-3" />
                    Events
                  </TabsTrigger>
                  <TabsTrigger value="health" className="gap-1 text-[10px]">
                    <HeartPulse className="h-3 w-3" />
                    Health
                  </TabsTrigger>
                </TabsList>
                <div className="ml-auto min-w-0 max-w-[50%]">
                  <GitStatusPill
                    summary={session.gitSummary}
                    cwd={session.config.cwd}
                    compact
                  />
                </div>
              </div>
              <TabsContent
                value="changes"
                className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
              >
                <div className="h-full">
                  <DiffPanel />
                </div>
              </TabsContent>
              <TabsContent
                value="review"
                className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
              >
                <div className="h-full">
                  <GitPanel />
                </div>
              </TabsContent>
              <TabsContent
                value="events"
                className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
              >
                <div className="h-full">
                  <LogPanel />
                </div>
              </TabsContent>
              <TabsContent
                value="health"
                className="mt-0 min-h-0 flex-1 overflow-auto data-[state=inactive]:hidden"
              >
                <OverviewPanel />
              </TabsContent>
            </Tabs>
          </div>
        </Panel>
      </Group>
      <PromptComposer />
    </div>
  );
}

function LeftModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Brain;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition",
        active
          ? "bg-phosphor-green/15 text-phosphor-green"
          : "text-phosphor-green/45 hover:bg-phosphor-green/8 hover:text-phosphor-green/75"
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
