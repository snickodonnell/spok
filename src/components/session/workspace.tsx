"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useSpokStore } from "@/lib/store";
import { TracePanel } from "@/components/trace/trace-panel";
import { EventGraphPanel } from "@/components/trace/event-graph-panel";
import { DiffPanel } from "@/components/diff/diff-panel";
import { LogPanel } from "@/components/session/log-panel";
import { OverviewPanel } from "@/components/session/overview-panel";
import { ValidationPanel } from "@/components/session/validation-panel";
import { GitPanel } from "@/components/git/git-panel";
import { GitStatusPill } from "@/components/git/git-status-pill";
import { PromptComposer } from "@/components/session/prompt-composer";
import { RunStatusCard } from "@/components/session/run-status-card";
import { SubagentLanesStrip } from "@/components/automation/subagent-lanes-strip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileCode2,
  ScrollText,
  HeartPulse,
  GitPullRequest,
  Brain,
  ListTree,
  FlaskConical,
} from "lucide-react";
import type { WorkspaceRightTab } from "@/lib/types";
import { cn } from "@/lib/utils";
import { localFetch } from "@/lib/local-api-client";
import { useMemo, useEffect, useRef } from "react";
import {
  buildValidationLane,
  validationTabBadge,
} from "@/lib/validation-lane";
import { buildReviewQueue } from "@/lib/review-queue";
import { startMark } from "@/lib/perf";

/**
 * Primary live harness surface (Horizon 1 product coherence):
 * - Run status card (cwd, branch, permission, CLI, dirty, stop)
 * - Left: Thinking feed or Event graph
 * - Right: Changes / Review / Validation / Events / Health
 * - Composer cockpit docked at bottom
 */
export function Workspace() {
  const sessionId = useSpokStore((s) => s.activeSessionId);
  const sessionCwd = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.config.cwd : undefined
  );
  const gitSummary = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId]?.gitSummary : undefined
  );
  const filesChanged = useSpokStore((s) => {
    const id = s.activeSessionId;
    if (!id) return 0;
    return Object.keys(s.sessions[id]?.files ?? {}).length;
  });
  // Only recompute validation badge when error-ish metrics move (not every token).
  const validationKey = useSpokStore((s) => {
    const sess = s.activeSessionId
      ? s.sessions[s.activeSessionId]
      : null;
    if (!sess) return "";
    return `${sess.metrics.errorCount}:${sess.metrics.toolCallCount}:${sess.status}`;
  });
  const rightTab = useSpokStore((s) => s.workspaceRightTab);
  const setRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const leftMode = useSpokStore((s) => s.leftTraceMode);
  const setLeftMode = useSpokStore((s) => s.setLeftTraceMode);
  const updateSession = useSpokStore((s) => s.updateSession);

  const validationBadge = useMemo(() => {
    // Selector fingerprint intentionally gates this heavier derived scan.
    void validationKey;
    if (!sessionId) return 0;
    const session = useSpokStore.getState().sessions[sessionId];
    if (!session) return 0;
    return validationTabBadge(buildValidationLane(session).summary);
  }, [sessionId, validationKey]);

  const reviewAttention = useMemo(() => {
    // These lightweight selectors intentionally gate the review queue scan.
    void filesChanged;
    void validationKey;
    if (!sessionId) return 0;
    const session = useSpokStore.getState().sessions[sessionId];
    if (!session) return 0;
    const q = buildReviewQueue(session);
    return q.summary.highRiskCount + q.summary.issueCount;
  }, [sessionId, filesChanged, validationKey]);

  const prevTab = useRef(rightTab);
  useEffect(() => {
    if (prevTab.current === rightTab) return;
    const mark = startMark("diff_tab_switch");
    // Measure after paint of the newly selected right tab
    requestAnimationFrame(() => {
      mark.end({ tab: rightTab, from: prevTab.current });
      prevTab.current = rightTab;
    });
  }, [rightTab]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Open a workspace to start
      </div>
    );
  }

  const dirtyCount = gitSummary
    ? gitSummary.stagedCount +
      gitSummary.unstagedCount +
      gitSummary.untrackedCount
    : filesChanged;

  const stopRun = async () => {
    await localFetch(
      `/api/session/start?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    ).catch(() => undefined);
    updateSession(sessionId, { status: "stopped" });
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
              <div
                className="flex min-h-10 shrink-0 items-center gap-2 border-b border-phosphor-green/15 px-2 py-1"
                data-testid="workspace-right-tabs"
              >
                <TabsList className="h-8">
                  <TabsTrigger
                    value="changes"
                    className="gap-1 text-[10px]"
                    data-testid="tab-changes"
                  >
                    <FileCode2 className="h-3 w-3" />
                    Changes
                    {dirtyCount > 0 && (
                      <span className="ml-0.5 rounded bg-phosphor-amber/20 px-1 font-mono text-[9px] text-phosphor-amber">
                        {dirtyCount}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="review"
                    className="gap-1 text-[10px]"
                    data-testid="tab-review"
                  >
                    <GitPullRequest className="h-3 w-3" />
                    Review
                    {reviewAttention > 0 && (
                      <span className="ml-0.5 rounded bg-phosphor-amber/20 px-1 font-mono text-[9px] text-phosphor-amber">
                        {reviewAttention}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="validation"
                    className="gap-1 text-[10px]"
                    data-testid="tab-validation"
                  >
                    <FlaskConical className="h-3 w-3" />
                    Validation
                    {validationBadge > 0 && (
                      <span
                        className={cn(
                          "ml-0.5 rounded px-1 font-mono text-[9px]",
                          "bg-phosphor-amber/20 text-phosphor-amber"
                        )}
                      >
                        {validationBadge}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="events"
                    className="gap-1 text-[10px]"
                    data-testid="tab-events"
                  >
                    <ScrollText className="h-3 w-3" />
                    Events
                  </TabsTrigger>
                  <TabsTrigger
                    value="health"
                    className="gap-1 text-[10px]"
                    data-testid="tab-health"
                  >
                    <HeartPulse className="h-3 w-3" />
                    Health
                  </TabsTrigger>
                </TabsList>
                <div className="ml-auto min-w-0 max-w-[50%]">
                  <GitStatusPill
                    summary={gitSummary}
                    cwd={sessionCwd}
                    compact
                  />
                </div>
              </div>
              {/*
                Mount only the active right tab. Previously all five panels
                (Monaco, Git, Validation, Log, Health) stayed mounted and
                re-rendered on every stream tick while CSS-hidden.
              */}
              <div className="mt-0 min-h-0 flex-1">
                {rightTab === "changes" && (
                  <div className="h-full">
                    <DiffPanel />
                  </div>
                )}
                {rightTab === "review" && (
                  <div className="h-full">
                    <GitPanel />
                  </div>
                )}
                {rightTab === "validation" && (
                  <div className="h-full">
                    <ValidationPanel />
                  </div>
                )}
                {rightTab === "events" && (
                  <div className="h-full">
                    <LogPanel />
                  </div>
                )}
                {rightTab === "health" && (
                  <div className="h-full overflow-auto">
                    <OverviewPanel />
                  </div>
                )}
              </div>
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
