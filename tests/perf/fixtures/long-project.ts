/**
 * Deterministic long-project fixtures for performance budget gates.
 * Fixed seeds, no network, no wall-clock dependence beyond measured durations.
 */

import { PERF_HOT_BOUNDS } from "../../../src/lib/perf";
import { buildEnterpriseMissionPrompt } from "../../../src/lib/enterprise";
import type { AutomationJob } from "../../../src/lib/automation/types";
import type { Session, StreamEvent, TraceNode } from "../../../src/lib/types";

/** Fixed epoch so timestamps are stable across runs. */
export const PERF_FIXTURE_SEED = 1_700_000_000_000;

export function emptyPerfSession(id: string, createdAt = PERF_FIXTURE_SEED): Session {
  return {
    id,
    name: "perf-long-project",
    status: "ready",
    createdAt,
    updatedAt: createdAt,
    config: {
      cwd: "C:\\tmp\\perf-repo",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: createdAt,
      endedAt: null,
      elapsedMs: 0,
      toolCallCount: 0,
      thinkingSteps: 0,
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      subagentCount: 0,
      errorCount: 0,
    },
    rootTraceIds: [],
    nodes: {},
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: "sample",
    promptHistory: [],
    eventLog: [],
    eventCount: 0,
  };
}

/** 100-job mission-control fleet (enterprise-linked, deterministic). */
export function buildHundredJobs(
  count = PERF_HOT_BOUNDS.missionControlJobs
): AutomationJob[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `perf-job-${String(index).padStart(3, "0")}`,
    kind: "background" as const,
    title: `Mission ${index}`,
    prompt: buildEnterpriseMissionPrompt({
      goal: `Deliver milestone ${index}`,
      crew: [],
    }),
    cwd: "C:\\repo",
    isolate: true,
    status: index % 5 === 0 ? ("running" as const) : ("queued" as const),
    priority: index % 7,
    createdAt: PERF_FIXTURE_SEED + index,
    updatedAt: PERF_FIXTURE_SEED + index + 1,
    enterprise: {
      version: 1 as const,
      teamId: `mission-${Math.floor(index / 5)}`,
      role: "leader" as const,
      phase: index % 5 === 0 ? ("mission" as const) : ("followup" as const),
      turn: (index % 5) + 1,
      memberId: "spok",
      memberName: "Spok",
    },
  }));
}

/**
 * Build a session with N concurrent agent lanes (subagent roots + tools).
 * Deterministic node ids — no nanoid.
 */
export function buildMultiLaneSession(
  laneCount = PERF_HOT_BOUNDS.concurrentAgentLanes,
  toolsPerLane = 4
): Session {
  const session = emptyPerfSession("perf-10-lanes");
  const nodes: Record<string, TraceNode> = {};
  const rootTraceIds: string[] = [];
  let toolCalls = 0;
  let thinking = 0;

  for (let lane = 0; lane < laneCount; lane++) {
    const laneId = `lane-${String(lane).padStart(2, "0")}`;
    const subId = `sub-${laneId}`;
    const t0 = PERF_FIXTURE_SEED + lane * 10_000;
    nodes[subId] = {
      id: subId,
      parentId: null,
      type: "subagent",
      title: `Agent lane ${lane}`,
      content: `Lane ${lane} specialized work`,
      summary: `Lane ${lane} summary`,
      timestamp: t0,
      status: lane % 3 === 0 ? "running" : "success",
      children: [],
      links: [],
      depth: 0,
      subagentId: laneId,
      meta: { childSessionId: `child-${laneId}` },
    };
    rootTraceIds.push(subId);

    for (let t = 0; t < toolsPerLane; t++) {
      const toolId = `tool-${laneId}-${t}`;
      const thinkId = `think-${laneId}-${t}`;
      nodes[thinkId] = {
        id: thinkId,
        parentId: subId,
        type: "thinking",
        title: "think",
        content: `thinking ${lane}/${t}`,
        timestamp: t0 + t * 2 + 1,
        status: "success",
        children: [],
        links: [],
        depth: 1,
        subagentId: laneId,
      };
      nodes[toolId] = {
        id: toolId,
        parentId: subId,
        type: "tool_call",
        title: "tool",
        content: `tool ${lane}/${t}`,
        toolName: "read_file",
        timestamp: t0 + t * 2 + 2,
        status: "success",
        children: [],
        links: [],
        depth: 1,
        subagentId: laneId,
      };
      nodes[subId].children.push(thinkId, toolId);
      toolCalls += 1;
      thinking += 1;
    }
  }

  session.nodes = nodes;
  session.rootTraceIds = rootTraceIds;
  session.metrics = {
    ...session.metrics,
    toolCallCount: toolCalls,
    thinkingSteps: thinking,
    subagentCount: laneCount,
  };
  session.subagentLanes = undefined;
  return session;
}

/**
 * Deterministic stream of hot events (thinking / tool_call mix).
 * Fixed ids and timestamps from seed.
 */
export function buildHotEvents(
  count = PERF_HOT_BOUNDS.longProjectHotEvents,
  sessionId = "perf-hot-10k"
): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (let i = 0; i < count; i++) {
    const isTool = i % 5 === 0;
    events.push({
      version: 1,
      type: isTool ? "tool_call" : "thinking",
      timestamp: PERF_FIXTURE_SEED + i,
      sessionId,
      id: `hot-e${String(i).padStart(5, "0")}`,
      title: isTool ? "tool" : "think",
      content: isTool ? `tool chunk ${i}` : `think chunk ${i}`,
      status: "running",
      toolName: isTool ? "read_file" : undefined,
    });
  }
  return events;
}

/** Sliding virtualized render window — fixture-owned hot projection. */
export type HotRenderWindow = {
  offset: number;
  size: number;
  total: number;
  items: StreamEvent[];
};

export function projectHotRenderWindow(
  events: StreamEvent[],
  offset: number,
  size = PERF_HOT_BOUNDS.renderWindowEvents
): HotRenderWindow {
  const total = events.length;
  const safeSize = Math.max(1, Math.min(size, PERF_HOT_BOUNDS.renderWindowEvents));
  const maxOffset = Math.max(0, total - safeSize);
  const safeOffset = Math.max(0, Math.min(offset, maxOffset));
  return {
    offset: safeOffset,
    size: safeSize,
    total,
    items: events.slice(safeOffset, safeOffset + safeSize),
  };
}

/**
 * Checkpoint-first useful content: metrics, hot event tail, root ids, lane count.
 * Pure projection from a materialized snapshot — no cold event replay.
 */
export type CheckpointUsefulProjection = {
  sessionId: string;
  name: string;
  status: Session["status"];
  metrics: Session["metrics"];
  rootTraceCount: number;
  nodeCount: number;
  hotEventTail: StreamEvent[];
  hotEventTailSize: number;
  selectedTraceId: string | null;
  eventCount: number;
  usefulSummary: string;
};

export function projectCheckpointUsefulContent(
  snapshot: Session
): CheckpointUsefulProjection {
  const eventLog = snapshot.eventLog ?? [];
  const hotEventTail =
    eventLog.length > PERF_HOT_BOUNDS.hotEventLog
      ? eventLog.slice(eventLog.length - PERF_HOT_BOUNDS.hotEventLog)
      : eventLog.slice();
  const nodeCount = Object.keys(snapshot.nodes).length;
  const rootTraceCount = snapshot.rootTraceIds.length;
  const usefulSummary = [
    snapshot.name,
    `status=${snapshot.status}`,
    `nodes=${nodeCount}`,
    `roots=${rootTraceCount}`,
    `tools=${snapshot.metrics.toolCallCount}`,
    `events=${snapshot.eventCount ?? eventLog.length}`,
  ].join(" · ");

  return {
    sessionId: snapshot.id,
    name: snapshot.name,
    status: snapshot.status,
    metrics: { ...snapshot.metrics },
    rootTraceCount,
    nodeCount,
    hotEventTail,
    hotEventTailSize: hotEventTail.length,
    selectedTraceId: snapshot.selectedTraceId,
    eventCount: snapshot.eventCount ?? eventLog.length,
    usefulSummary,
  };
}

/**
 * Build a lean checkpoint snapshot as if restored from disk:
 * many historical nodes already materialized, short eventLog tail only.
 */
export function buildCheckpointSnapshot(opts?: {
  coldNodeCount?: number;
  hotEventTail?: number;
}): Session {
  const coldNodeCount = opts?.coldNodeCount ?? 2_000;
  const hotTail = opts?.hotEventTail ?? PERF_HOT_BOUNDS.hotEventLog;
  const session = emptyPerfSession("perf-checkpoint");
  const nodes: Record<string, TraceNode> = {};
  const rootTraceIds: string[] = [];

  for (let i = 0; i < coldNodeCount; i++) {
    const id = `ckpt-n${String(i).padStart(5, "0")}`;
    nodes[id] = {
      id,
      parentId: null,
      type: i % 4 === 0 ? "tool_call" : "thinking",
      title: i % 4 === 0 ? "tool" : "think",
      content: `checkpoint node ${i}`,
      timestamp: PERF_FIXTURE_SEED + i,
      status: "success",
      children: [],
      links: [],
      depth: 0,
    };
    if (i % 20 === 0) rootTraceIds.push(id);
  }

  const eventLog: StreamEvent[] = [];
  for (let i = 0; i < hotTail; i++) {
    eventLog.push({
      version: 1,
      type: "thinking",
      timestamp: PERF_FIXTURE_SEED + coldNodeCount + i,
      id: `ckpt-hot-${i}`,
      title: "think",
      content: `hot tail ${i}`,
      status: "success",
    });
  }

  session.nodes = nodes;
  session.rootTraceIds = rootTraceIds;
  session.eventLog = eventLog;
  session.eventCount = 50_000; // cold history much larger than hot tail
  session.metrics = {
    ...session.metrics,
    toolCallCount: Math.floor(coldNodeCount / 4),
    thinkingSteps: coldNodeCount - Math.floor(coldNodeCount / 4),
    endedAt: PERF_FIXTURE_SEED + coldNodeCount,
    elapsedMs: coldNodeCount,
  };
  session.selectedTraceId = rootTraceIds[rootTraceIds.length - 1] ?? null;
  session.hydratePartial = false;
  session.restoreState = "available";
  session.durable = true;
  session.source = "resume";
  return session;
}

/**
 * Fixture-owned hot state that never grows past render window + hot event log.
 * Models correct hot/cold separation for budget tests.
 */
export class BoundedHotState {
  readonly renderWindowSize: number;
  readonly hotEventLogCap: number;
  private renderItems: StreamEvent[] = [];
  private hotLog: StreamEvent[] = [];
  private totalSeen = 0;
  private navOffset = 0;

  constructor(
    renderWindowSize = PERF_HOT_BOUNDS.renderWindowEvents,
    hotEventLogCap = PERF_HOT_BOUNDS.hotEventLog
  ) {
    this.renderWindowSize = renderWindowSize;
    this.hotEventLogCap = hotEventLogCap;
  }

  ingest(events: StreamEvent[]): void {
    for (const e of events) {
      this.totalSeen += 1;
      this.hotLog.push(e);
      if (this.hotLog.length > this.hotEventLogCap) {
        this.hotLog.splice(0, this.hotLog.length - this.hotEventLogCap);
      }
    }
    // Keep render window at end (auto-scroll) unless navigating.
    this.syncRenderFromHotLog();
  }

  /** Navigate to an absolute offset into the *logical* hot stream (fixture index). */
  navigate(absoluteOffset: number, allHotEvents: StreamEvent[]): HotRenderWindow {
    const win = projectHotRenderWindow(
      allHotEvents,
      absoluteOffset,
      this.renderWindowSize
    );
    this.navOffset = win.offset;
    this.renderItems = win.items;
    return win;
  }

  private syncRenderFromHotLog(): void {
    const start = Math.max(0, this.hotLog.length - this.renderWindowSize);
    this.renderItems = this.hotLog.slice(start);
    this.navOffset = start;
  }

  get stats() {
    return {
      totalSeen: this.totalSeen,
      hotLogSize: this.hotLog.length,
      renderSize: this.renderItems.length,
      navOffset: this.navOffset,
    };
  }

  assertBounded(): void {
    if (this.hotLog.length > this.hotEventLogCap) {
      throw new Error(
        `hot log unbounded: ${this.hotLog.length} > ${this.hotEventLogCap}`
      );
    }
    if (this.renderItems.length > this.renderWindowSize) {
      throw new Error(
        `render window unbounded: ${this.renderItems.length} > ${this.renderWindowSize}`
      );
    }
  }
}
