/**
 * P0-8 production regression: after 10k reduceStreamEvents, hot session.nodes
 * must stay within MAX_HOT_NODES (not ~10_000). Cold evidence remains in the
 * event stream for recovery/replay.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundHotNodes,
  MAX_HOT_NODES,
  reduceStreamEvents,
  recomputeSessionMetrics,
} from "../../src/lib/session-reduce";
import {
  boundSessionHotNodes,
  rehydrateSessionFromEvents,
} from "../../src/lib/session-hydrate";
import type { Session, StreamEvent } from "../../src/lib/types";

function emptySession(id = "hot-bound"): Session {
  return {
    id,
    name: "Hot bound",
    status: "idle",
    createdAt: 1_000,
    updatedAt: 1_000,
    config: {
      cwd: "/tmp",
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
    source: "live",
    promptHistory: [],
    eventLog: [],
    durable: false,
    eventCount: 0,
  };
}

function makeEvents(count: number, startTs = 10_000): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (let i = 0; i < count; i++) {
    const isTool = i % 5 === 0;
    events.push({
      version: 1,
      type: isTool ? "tool_call" : "thinking",
      timestamp: startTs + i,
      id: `n${String(i).padStart(5, "0")}`,
      title: isTool ? "tool" : "think",
      content: isTool ? `tool body ${i}` : `thought ${i}`,
      status: isTool ? "running" : "success",
      toolName: isTool ? "read" : undefined,
      provider: "grok",
    });
  }
  return events;
}

describe("P0-8 hot session.nodes bound", () => {
  it("10k reduce: hot nodes stay within MAX_HOT_NODES (not ~10k)", () => {
    const total = 10_000;
    const events = makeEvents(total);
    const result = reduceStreamEvents(emptySession(), new Set(), events);
    const nodeCount = Object.keys(result.session.nodes).length;
    const eventLogLen = result.session.eventLog?.length ?? 0;

    assert.equal(result.session.eventCount, total);
    assert.ok(
      eventLogLen <= 8_000,
      `eventLog should stay capped, got ${eventLogLen}`
    );
    assert.ok(
      nodeCount <= MAX_HOT_NODES,
      `hot nodes unbounded: ${nodeCount} > ${MAX_HOT_NODES}`
    );
    assert.ok(
      nodeCount < total,
      `hot nodes should not grow 1:1 with events (${nodeCount} vs ${total})`
    );
    assert.ok(
      (result.session.coldNodeCount ?? 0) >= total - MAX_HOT_NODES,
      `coldNodeCount should account for demotions, got ${result.session.coldNodeCount}`
    );
    // Cumulative metrics from full batch (before demote) must not collapse to hot-only.
    assert.equal(result.session.metrics.thinkingSteps, total - Math.floor(total / 5));
    assert.equal(result.session.metrics.toolCallCount, Math.floor(total / 5));
    // Newest nodes remain hot.
    assert.ok(result.session.nodes[`n${String(total - 1).padStart(5, "0")}`]);
    // Oldest nodes are cold (demoted from hot map) but still in the source events.
    assert.equal(result.session.nodes["n00000"], undefined);
    assert.equal(events[0]?.id, "n00000");
  });

  it("boundary: exactly MAX_HOT_NODES stays undemoted; +1 demotes deterministically", () => {
    const atCap = makeEvents(MAX_HOT_NODES);
    const at = reduceStreamEvents(emptySession("at-cap"), new Set(), atCap);
    assert.equal(Object.keys(at.session.nodes).length, MAX_HOT_NODES);
    assert.ok(!(at.session.coldNodeCount > 0));

    const over = makeEvents(MAX_HOT_NODES + 1);
    const o = reduceStreamEvents(emptySession("over-cap"), new Set(), over);
    assert.equal(Object.keys(o.session.nodes).length, MAX_HOT_NODES);
    assert.equal(o.session.coldNodeCount, 1);
    // Oldest demoted first (deterministic timestamps).
    assert.equal(o.session.nodes["n00000"], undefined);
    assert.ok(o.session.nodes[`n${String(MAX_HOT_NODES).padStart(5, "0")}`]);
  });

  it("multi-batch reduce keeps metrics cumulative after cold window opens", () => {
    const batch1 = makeEvents(MAX_HOT_NODES + 50, 1_000);
    let session = reduceStreamEvents(emptySession("multi"), new Set(), batch1)
      .session;
    const toolsAfter1 = session.metrics.toolCallCount;
    const thinkAfter1 = session.metrics.thinkingSteps;
    assert.ok((session.coldNodeCount ?? 0) > 0);

    const batch2 = makeEvents(100, 100_000).map((e, i) => ({
      ...e,
      id: `b2-${i}`,
    }));
    session = reduceStreamEvents(session, new Set(), batch2).session;

    assert.ok(Object.keys(session.nodes).length <= MAX_HOT_NODES);
    assert.ok(
      session.metrics.toolCallCount >= toolsAfter1,
      "toolCallCount must not drop after further cold demotion"
    );
    assert.ok(
      session.metrics.thinkingSteps >= thinkAfter1,
      "thinkingSteps must not drop after further cold demotion"
    );
    // batch2 is 100 events: 20 tools (every 5th) + 80 thoughts
    assert.equal(session.metrics.toolCallCount, toolsAfter1 + 20);
    assert.equal(session.metrics.thinkingSteps, thinkAfter1 + 80);
  });

  it("replay/rehydrate from events recovers hot evidence without unbounded nodes", () => {
    const total = 10_000;
    const events = makeEvents(total);
    const reduced = reduceStreamEvents(emptySession("recover"), new Set(), events)
      .session;
    assert.ok(Object.keys(reduced.nodes).length <= MAX_HOT_NODES);

    // Full event list is the cold/raw recoverability path (durable log analogue).
    const recovered = rehydrateSessionFromEvents(
      {
        ...reduced,
        // simulate checkpoint shell: keep metrics + eventCount, drop hot nodes
        nodes: {},
        rootTraceIds: [],
        coldNodeCount: reduced.coldNodeCount,
      },
      events
    );

    assert.equal(recovered.eventCount, total);
    assert.ok(
      Object.keys(recovered.nodes).length <= MAX_HOT_NODES,
      "rehydrate must not reintroduce unbounded hot nodes"
    );
    // Recent evidence materializes into the hot window.
    const lastId = `n${String(total - 1).padStart(5, "0")}`;
    assert.ok(recovered.nodes[lastId], "latest event node should be hot after rehydrate");
    assert.ok(
      recovered.metrics.toolCallCount >= Math.floor(total / 5),
      "rehydrate preserves cumulative tool metrics"
    );
    // Source events still hold the earliest evidence even if not hot.
    assert.equal(events[0]?.content, "tool body 0");
  });

  it("boundHotNodes is deterministic at the same inputs", () => {
    const nodes: Session["nodes"] = {};
    const roots: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `d${i}`;
      nodes[id] = {
        id,
        parentId: null,
        type: "thinking",
        title: "t",
        content: `c${i}`,
        timestamp: 1000 + i,
        status: "success",
        children: [],
        links: [],
        depth: 0,
      };
      roots.push(id);
    }
    const a = boundHotNodes(nodes, roots, { maxHotNodes: 40 });
    const b = boundHotNodes(nodes, roots, { maxHotNodes: 40 });
    assert.deepEqual(Object.keys(a.nodes).sort(), Object.keys(b.nodes).sort());
    assert.equal(a.demoted, 60);
    assert.equal(Object.keys(a.nodes).length, 40);
    // Newest retained.
    assert.ok(a.nodes["d99"]);
    assert.equal(a.nodes["d0"], undefined);
  });

  it("hydrate path bounds fat checkpoint snapshots", () => {
    const fat = emptySession("fat-snap");
    for (let i = 0; i < MAX_HOT_NODES + 500; i++) {
      const id = `f${i}`;
      fat.nodes[id] = {
        id,
        parentId: null,
        type: "thinking",
        title: "t",
        content: `x${i}`,
        timestamp: i,
        status: "success",
        children: [],
        links: [],
        depth: 0,
      };
      fat.rootTraceIds.push(id);
    }
    fat.metrics.thinkingSteps = MAX_HOT_NODES + 500;
    fat.eventCount = MAX_HOT_NODES + 500;

    const bounded = boundSessionHotNodes(fat);
    assert.ok(Object.keys(bounded.nodes).length <= MAX_HOT_NODES);
    assert.ok((bounded.coldNodeCount ?? 0) >= 500);
    // Metrics on the snapshot remain cumulative (not re-derived from hot only).
    assert.equal(bounded.metrics.thinkingSteps, MAX_HOT_NODES + 500);
  });

  it("recomputeSessionMetrics on hot-only map undercounts once cold — session.metrics is authoritative", () => {
    const events = makeEvents(MAX_HOT_NODES + 200);
    const session = reduceStreamEvents(emptySession("auth-metrics"), new Set(), events)
      .session;
    const hotOnly = recomputeSessionMetrics(session);
    assert.ok(
      session.metrics.thinkingSteps > hotOnly.thinkingSteps ||
        session.metrics.toolCallCount > hotOnly.toolCallCount,
      "after demotion, full recompute from hot map undercounts; use session.metrics"
    );
  });
});
