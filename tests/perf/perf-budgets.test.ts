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
});
