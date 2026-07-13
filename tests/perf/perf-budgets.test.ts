import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  PERF_BUDGETS,
  clearPerfSamples,
  getPerfSummary,
  measureSync,
  recordPerf,
  startMark,
} from "../../src/lib/perf";
import { reduceStreamEvents } from "../../src/lib/session-reduce";
import { buildSessionInbox } from "../../src/lib/session-inbox";
import {
  buildEnterpriseMissionPrompt,
  buildEnterpriseTeams,
} from "../../src/lib/enterprise";
import type { AutomationJob } from "../../src/lib/automation/types";
import type { Session, StreamEvent } from "../../src/lib/types";

function emptySession(id: string): Session {
  return {
    id,
    name: "perf",
    status: "ready",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: {
      cwd: "C:\\tmp",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: null,
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
  };
}

describe("perf telemetry", () => {
  beforeEach(() => {
    clearPerfSamples();
  });

  it("records samples and flags over-budget", () => {
    recordPerf("stream_ingest_burst", 5);
    recordPerf("stream_ingest_burst", 50);
    const summary = getPerfSummary();
    assert.equal(summary.count, 2);
    assert.ok(summary.overBudget >= 1);
    assert.ok(summary.byName.stream_ingest_burst);
  });

  it("measureSync times a function", () => {
    const out = measureSync("reduce_batch", () => 42);
    assert.equal(out, 42);
    assert.equal(getPerfSummary().count, 1);
  });

  it("startMark end records duration", () => {
    const m = startMark("fixture_replay");
    const sample = m.end({ events: 10 });
    assert.ok(sample.durationMs >= 0);
    assert.equal(sample.meta?.events, 10);
  });

  it("fixture replay of 2k events meets throughput budget", () => {
    const session = emptySession("perfReplay01");
    const events: StreamEvent[] = [];
    for (let i = 0; i < 2000; i++) {
      events.push({
        type: i % 5 === 0 ? "tool_call" : "thinking",
        timestamp: Date.now() + i,
        id: `e${i}`,
        title: i % 5 === 0 ? "tool" : "think",
        content: `chunk ${i} `.repeat(3),
        status: "running",
      });
    }

    const t0 = performance.now();
    reduceStreamEvents(session, new Set<string>(), events);
    const ms = performance.now() - t0;
    recordPerf("fixture_replay", ms, { events: events.length });

    const eventsPerSec = (events.length / Math.max(ms, 0.001)) * 1000;
    assert.ok(
      eventsPerSec >= PERF_BUDGETS.streamEventsPerSec,
      `throughput ${eventsPerSec.toFixed(0)}/s below floor ${PERF_BUDGETS.streamEventsPerSec}`
    );
    // Soft budget: 2k events should usually finish under fixtureReplayMs on CI
    assert.ok(
      ms < PERF_BUDGETS.fixtureReplayMs * 3,
      `replay took ${ms.toFixed(1)}ms (hard ceiling 3x budget)`
    );
  });

  it("projects a 100-job mission control fleet within one frame", () => {
    const jobs: AutomationJob[] = Array.from({ length: 100 }, (_, index) => ({
      id: `perf-job-${index}`,
      kind: "background" as const,
      title: `Mission ${index}`,
      prompt: buildEnterpriseMissionPrompt({
        goal: `Deliver milestone ${index}`,
        crew: [],
      }),
      cwd: "C:\\repo",
      isolate: true,
      status: index % 5 === 0 ? "running" as const : "queued" as const,
      priority: index % 7,
      createdAt: index,
      updatedAt: index + 1,
      enterprise: {
        version: 1,
        teamId: `mission-${Math.floor(index / 5)}`,
        role: "leader" as const,
        phase: index % 5 === 0 ? "mission" as const : "followup" as const,
        turn: (index % 5) + 1,
        memberId: "spok",
        memberName: "Spok",
      },
    }));

    // Warm the projection paths before measuring the representative update.
    buildSessionInbox([], { jobs, maxConcurrentBackground: 8 });
    buildEnterpriseTeams(jobs, {});

    const inboxStart = performance.now();
    const inbox = buildSessionInbox([], {
      jobs,
      maxConcurrentBackground: 8,
    });
    const inboxMs = performance.now() - inboxStart;
    recordPerf("inbox_projection", inboxMs, { jobs: jobs.length });

    const missionStart = performance.now();
    const missions = buildEnterpriseTeams(jobs, {});
    const missionMs = performance.now() - missionStart;
    recordPerf("mission_projection", missionMs, { jobs: jobs.length });

    assert.equal(inbox.entries.length, 100);
    assert.equal(missions.length, 20);
    assert.ok(
      inboxMs < PERF_BUDGETS.missionControlProjectionMs,
      `inbox projection took ${inboxMs.toFixed(1)}ms`
    );
    assert.ok(
      missionMs < PERF_BUDGETS.missionControlProjectionMs,
      `mission projection took ${missionMs.toFixed(1)}ms`
    );
  });
});
