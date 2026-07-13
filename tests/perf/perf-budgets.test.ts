import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  PERF_BUDGETS,
  PERF_HOT_BOUNDS,
  budgetMsFor,
  ciBudgetMultiplier,
  clearPerfSamples,
  getPerfSummary,
  isOverBudget,
  measureSync,
  recordPerf,
  startMark,
} from "../../src/lib/perf";
import { reduceStreamEvents } from "../../src/lib/session-reduce";
import { buildSessionInbox } from "../../src/lib/session-inbox";
import {
  buildEnterpriseTeams,
  enterpriseLanes,
  enterpriseTraceNodes,
} from "../../src/lib/enterprise";
import { extractSubagentLanes } from "../../src/lib/automation/subagent-lanes";
import {
  BoundedHotState,
  buildCheckpointSnapshot,
  buildHotEvents,
  buildHundredJobs,
  buildMultiLaneSession,
  emptyPerfSession,
  projectCheckpointUsefulContent,
  projectHotRenderWindow,
} from "./fixtures/long-project";

/** Soft multiplier for full-history reduce paths (noisy CI hosts). */
const FIXTURE_REPLAY_MULT = 3;

describe("perf telemetry", () => {
  beforeEach(() => {
    clearPerfSamples();
  });

  it("records samples and flags over-budget (success + failure paths)", () => {
    const under = recordPerf("stream_ingest_burst", 5);
    assert.equal(under.overBudget, false);
    assert.equal(under.budgetMs, PERF_BUDGETS.streamIngestBurstMs);

    const over = recordPerf("stream_ingest_burst", 50);
    assert.equal(over.overBudget, true);
    assert.ok(isOverBudget("stream_ingest_burst", 50));
    assert.equal(isOverBudget("stream_ingest_burst", 5), false);

    const summary = getPerfSummary();
    assert.equal(summary.count, 2);
    assert.ok(summary.overBudget >= 1);
    assert.ok(summary.byName.stream_ingest_burst);
    assert.equal(summary.byName.stream_ingest_burst.overBudget, 1);
  });

  it("flags checkpoint and hot-nav over-budget samples", () => {
    const ckOk = recordPerf("checkpoint_projection", 12);
    assert.equal(ckOk.budgetMs, PERF_BUDGETS.checkpointProjectionMs);
    assert.equal(ckOk.overBudget, false);

    const ckBad = recordPerf(
      "checkpoint_projection",
      PERF_BUDGETS.checkpointProjectionMs + 1
    );
    assert.equal(ckBad.overBudget, true);

    const navBad = recordPerf(
      "hot_event_nav",
      PERF_BUDGETS.hotEventNavigationMs + 10
    );
    assert.equal(navBad.overBudget, true);
    assert.ok(isOverBudget("hot_event_nav", 999));
  });

  it("budgetMsFor maps roadmap metric names", () => {
    assert.equal(budgetMsFor("inbox_projection"), PERF_BUDGETS.inboxUpdateMs);
    assert.equal(
      budgetMsFor("checkpoint_projection"),
      PERF_BUDGETS.checkpointProjectionMs
    );
    assert.equal(budgetMsFor("session_reopen"), PERF_BUDGETS.sessionReopenMs);
    assert.equal(
      budgetMsFor("hot_event_nav"),
      PERF_BUDGETS.hotEventNavigationMs
    );
    assert.equal(
      budgetMsFor("lane_projection"),
      PERF_BUDGETS.multiLaneProjectionMs
    );
    assert.equal(PERF_BUDGETS.checkpointProjectionMs, PERF_BUDGETS.sessionReopenMs);
    assert.equal(PERF_BUDGETS.inboxUpdateMs, PERF_BUDGETS.missionControlProjectionMs);
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
    const session = emptyPerfSession("perfReplay01");
    const events = buildHotEvents(2000, "perfReplay01");

    const t0 = performance.now();
    reduceStreamEvents(session, new Set<string>(), events);
    const ms = performance.now() - t0;
    recordPerf("fixture_replay", ms, { events: events.length });

    const eventsPerSec = (events.length / Math.max(ms, 0.001)) * 1000;
    assert.ok(
      eventsPerSec >= PERF_BUDGETS.streamEventsPerSec,
      `throughput ${eventsPerSec.toFixed(0)}/s below floor ${PERF_BUDGETS.streamEventsPerSec}`
    );
    assert.ok(
      ms < PERF_BUDGETS.fixtureReplayMs * FIXTURE_REPLAY_MULT,
      `replay took ${ms.toFixed(1)}ms (hard ceiling ${FIXTURE_REPLAY_MULT}x budget)`
    );
  });
});

describe("long-project performance gates", () => {
  beforeEach(() => {
    clearPerfSamples();
  });

  it("projects a 100-job mission control fleet within inbox 16ms hard ceiling", () => {
    const jobs = buildHundredJobs(PERF_HOT_BOUNDS.missionControlJobs);
    assert.equal(jobs.length, 100);

    // Warm projection paths before measuring the representative update.
    buildSessionInbox([], { jobs, maxConcurrentBackground: 8 });
    buildEnterpriseTeams(jobs, {});

    const mult = ciBudgetMultiplier();

    const inboxStart = performance.now();
    const inbox = buildSessionInbox([], {
      jobs,
      maxConcurrentBackground: 8,
    });
    const inboxMs = performance.now() - inboxStart;
    const inboxSample = recordPerf("inbox_projection", inboxMs, {
      jobs: jobs.length,
    });

    const missionStart = performance.now();
    const missions = buildEnterpriseTeams(jobs, {});
    const missionMs = performance.now() - missionStart;
    recordPerf("mission_projection", missionMs, { jobs: jobs.length });

    assert.equal(inbox.entries.length, 100);
    assert.equal(missions.length, 20);

    const inboxCeiling = PERF_BUDGETS.inboxUpdateMs * mult;
    assert.ok(
      inboxMs < inboxCeiling,
      `inbox projection took ${inboxMs.toFixed(2)}ms (budget ${inboxCeiling}ms; raw ${PERF_BUDGETS.inboxUpdateMs}ms × ${mult})`
    );
    assert.ok(
      missionMs < PERF_BUDGETS.missionControlProjectionMs * mult,
      `mission projection took ${missionMs.toFixed(2)}ms`
    );
    // Success path: under-budget sample must not flag.
    if (inboxMs <= PERF_BUDGETS.inboxUpdateMs) {
      assert.equal(inboxSample.overBudget, false);
    }
  });

  it("projects 10 concurrent agent lanes within multi-lane budget", () => {
    const session = buildMultiLaneSession(PERF_HOT_BOUNDS.concurrentAgentLanes);
    const sessions = { [session.id]: session };
    const mult = ciBudgetMultiplier();

    const t0 = performance.now();
    const lanes = extractSubagentLanes(session.nodes);
    const enterprise = enterpriseLanes(
      {
        id: "job-lanes",
        kind: "background",
        title: "lanes",
        prompt: "x",
        cwd: "C:\\repo",
        isolate: true,
        status: "running",
        priority: 0,
        createdAt: 0,
        sessionId: session.id,
      },
      sessions
    );
    // Per-lane trace projection (bounded limit) — mimics inspector switch.
    let projectedNodes = 0;
    for (const lane of lanes) {
      const nodes = enterpriseTraceNodes(
        {
          id: "job-lanes",
          kind: "background",
          title: "lanes",
          prompt: "x",
          cwd: "C:\\repo",
          isolate: true,
          status: "running",
          priority: 0,
          createdAt: 0,
          sessionId: session.id,
        },
        sessions,
        lane,
        80
      );
      projectedNodes += nodes.length;
      assert.ok(nodes.length <= 80, "trace projection must stay bounded");
    }
    const ms = performance.now() - t0;
    const sample = recordPerf("lane_projection", ms, {
      lanes: lanes.length,
      projectedNodes,
    });

    assert.equal(lanes.length, PERF_HOT_BOUNDS.concurrentAgentLanes);
    assert.equal(enterprise.length, PERF_HOT_BOUNDS.concurrentAgentLanes);
    assert.ok(projectedNodes > 0);

    const ceiling = PERF_BUDGETS.multiLaneProjectionMs * mult;
    assert.ok(
      ms < ceiling,
      `10-lane projection took ${ms.toFixed(2)}ms (budget ${ceiling}ms)`
    );
    if (ms <= PERF_BUDGETS.multiLaneProjectionMs) {
      assert.equal(sample.overBudget, false);
    }
  });

  it("10k hot events: bounded hot state + navigation under 250ms", () => {
    const total = PERF_HOT_BOUNDS.longProjectHotEvents;
    const events = buildHotEvents(total);
    assert.equal(events.length, total);

    const hot = new BoundedHotState();
    // Ingest in bursts (stream-like); hot structures must stay capped.
    const burst = 250;
    for (let i = 0; i < events.length; i += burst) {
      hot.ingest(events.slice(i, i + burst));
      hot.assertBounded();
    }
    const stats = hot.stats;
    assert.equal(stats.totalSeen, total);
    assert.ok(stats.hotLogSize <= PERF_HOT_BOUNDS.hotEventLog);
    assert.ok(stats.renderSize <= PERF_HOT_BOUNDS.renderWindowEvents);

    // Navigation proxy: sliding window jumps across 10k hot events.
    const mult = ciBudgetMultiplier();
    const ceiling = PERF_BUDGETS.hotEventNavigationMs * mult;
    const offsets = [0, 2500, 5000, 7500, total - 1, 1234, 9990];
    let maxNavMs = 0;

    for (const offset of offsets) {
      const t0 = performance.now();
      const win = projectHotRenderWindow(
        events,
        offset,
        PERF_HOT_BOUNDS.renderWindowEvents
      );
      // Touch items so work is not DCE'd.
      let checksum = 0;
      for (const e of win.items) checksum += e.id?.length ?? 0;
      const ms = performance.now() - t0;
      maxNavMs = Math.max(maxNavMs, ms);
      assert.ok(win.items.length <= PERF_HOT_BOUNDS.renderWindowEvents);
      assert.ok(win.items.length > 0 || total === 0);
      assert.ok(checksum >= 0);
      assert.ok(
        ms < ceiling,
        `hot-event nav at offset ${offset} took ${ms.toFixed(2)}ms (budget ${ceiling}ms)`
      );
    }

    const navSample = recordPerf("hot_event_nav", maxNavMs, {
      events: total,
      window: PERF_HOT_BOUNDS.renderWindowEvents,
    });
    assert.ok(maxNavMs < ceiling);
    if (maxNavMs <= PERF_BUDGETS.hotEventNavigationMs) {
      assert.equal(navSample.overBudget, false);
    }

    // Production reduce path: measure 10k reduce; assert eventLog bound.
    // Nodes may grow with event count (production concern) — we only hard-assert
    // structures that the reducer already caps, and record timing for Spok.
    const session = emptyPerfSession("perf-10k-reduce");
    const reduceStart = performance.now();
    const result = reduceStreamEvents(session, new Set<string>(), events);
    const reduceMs = performance.now() - reduceStart;
    recordPerf("fixture_replay", reduceMs, {
      events: total,
      path: "reduce_10k_hot",
    });

    const eventLogLen = result.session.eventLog?.length ?? 0;
    assert.ok(
      eventLogLen <= PERF_HOT_BOUNDS.reduceEventLogCap,
      `eventLog grew unbounded: ${eventLogLen}`
    );
    assert.equal(result.session.eventCount, total);

    // Soft ceiling on full reduce (not the 250ms nav budget — that's window projection).
    assert.ok(
      reduceMs < PERF_BUDGETS.fixtureReplayMs * FIXTURE_REPLAY_MULT,
      `10k reduce took ${reduceMs.toFixed(1)}ms (soft ceiling ${PERF_BUDGETS.fixtureReplayMs * FIXTURE_REPLAY_MULT}ms)`
    );

    // Document production node growth: each hot event becomes a node today.
    const nodeCount = Object.keys(result.session.nodes).length;
    recordPerf("reduce_batch", reduceMs, {
      nodes: nodeCount,
      events: total,
      note: "production nodes grow with hot events; fixture window stays bounded",
    });
  });

  it("checkpoint-first restore projection under 500ms hard ceiling", () => {
    // Snapshot already materialized (disk path mocked by in-memory fixture).
    // Cold history is represented by eventCount >> hot tail length.
    const snapshot = buildCheckpointSnapshot({
      coldNodeCount: 2_000,
      hotEventTail: PERF_HOT_BOUNDS.hotEventLog,
    });
    assert.ok((snapshot.eventCount ?? 0) > (snapshot.eventLog?.length ?? 0));

    const mult = ciBudgetMultiplier();
    const ceiling = PERF_BUDGETS.checkpointProjectionMs * mult;

    // Warm once
    projectCheckpointUsefulContent(snapshot);

    const t0 = performance.now();
    const useful = projectCheckpointUsefulContent(snapshot);
    // Also project inbox fingerprint-scale work from a single restored session shell.
    const inbox = buildSessionInbox(
      [
        {
          ...snapshot,
          // sidebar-scale: useful content without replaying 50k cold events
        },
      ],
      { jobs: [], maxConcurrentBackground: 8 }
    );
    const ms = performance.now() - t0;
    const sample = recordPerf("checkpoint_projection", ms, {
      nodes: useful.nodeCount,
      hotTail: useful.hotEventTailSize,
      coldEvents: useful.eventCount,
    });

    assert.ok(useful.usefulSummary.length > 0);
    assert.ok(useful.hotEventTailSize <= PERF_HOT_BOUNDS.hotEventLog);
    assert.equal(useful.nodeCount, 2_000);
    assert.equal(inbox.entries.length, 1);
    assert.ok(
      ms < ceiling,
      `checkpoint projection took ${ms.toFixed(2)}ms (budget ${ceiling}ms; raw ${PERF_BUDGETS.checkpointProjectionMs}ms)`
    );
    // session_reopen maps to the same 500ms ceiling
    assert.equal(
      budgetMsFor("session_reopen"),
      PERF_BUDGETS.checkpointProjectionMs
    );
    if (ms <= PERF_BUDGETS.checkpointProjectionMs) {
      assert.equal(sample.overBudget, false);
    }
  });

  it("failure path: deliberate over-budget sample is flagged", () => {
    const sample = recordPerf(
      "inbox_projection",
      PERF_BUDGETS.inboxUpdateMs + 100,
      { jobs: 100, synthetic: true }
    );
    assert.equal(sample.overBudget, true);
    assert.equal(sample.budgetMs, PERF_BUDGETS.inboxUpdateMs);
    assert.ok(getPerfSummary().overBudget >= 1);
  });

  it("failure path: unbounded render window is rejected by fixture", () => {
    const events = buildHotEvents(500);
    const win = projectHotRenderWindow(events, 0, 10_000);
    // Helper must clamp to PERF_HOT_BOUNDS.renderWindowEvents
    assert.ok(win.items.length <= PERF_HOT_BOUNDS.renderWindowEvents);
    assert.equal(win.size, PERF_HOT_BOUNDS.renderWindowEvents);

    const hot = new BoundedHotState(PERF_HOT_BOUNDS.renderWindowEvents, 10);
    hot.ingest(events);
    assert.doesNotThrow(() => hot.assertBounded());
    assert.ok(hot.stats.hotLogSize <= 10);
  });
});
