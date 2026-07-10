import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reduceStreamEvent,
  reduceStreamEvents,
  recomputeSessionMetrics,
} from "../../src/lib/session-reduce";
import type { Session, StreamEvent } from "../../src/lib/types";
import {
  clearStreamBatch,
  enqueueStreamEvents,
  flushStreamBatch,
  pendingStreamBatchCount,
} from "../../src/lib/stream-batch";
import { useSpokStore } from "../../src/lib/store";

function emptySession(id = "s1"): Session {
  return {
    id,
    name: "Test",
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

function ev(partial: Partial<StreamEvent> & { type: StreamEvent["type"] }): StreamEvent {
  return {
    version: 1,
    timestamp: partial.timestamp ?? Date.now(),
    provider: "grok",
    ...partial,
  } as StreamEvent;
}

describe("session reduce batching", () => {
  it("applies many events to the same final shape as sequential reduce", () => {
    const events: StreamEvent[] = [
      ev({
        type: "goal",
        id: "g1",
        timestamp: 1000,
        title: "You",
        content: "Do the thing",
        status: "success",
      }),
      ev({
        type: "thinking",
        id: "t1",
        timestamp: 1100,
        title: "Thinking",
        content: "First",
        status: "running",
      }),
      ev({
        type: "thinking",
        id: "t1",
        timestamp: 1200,
        title: "Thinking",
        content: "First thoughts expanded",
        status: "running",
      }),
      ev({
        type: "tool_call",
        id: "tc1",
        timestamp: 1300,
        title: "Tool: read",
        toolName: "read",
        content: "{}",
        status: "running",
        meta: { toolCallId: "call_1" },
      }),
      ev({
        type: "tool_result",
        id: "tc1",
        timestamp: 1400,
        title: "Result: read",
        toolName: "read",
        content: "ok",
        status: "success",
        meta: { toolCallId: "call_1" },
      }),
      ev({
        type: "file_change",
        id: "f1",
        timestamp: 1500,
        path: "src/a.ts",
        title: "File: src/a.ts",
        content: "modified",
        oldContent: "a\n",
        newContent: "b\n",
        diffStatus: "modified",
        status: "success",
      }),
    ];

    let sequential = emptySession();
    let expanded = new Set<string>();
    for (const e of events) {
      const r = reduceStreamEvent(sequential, expanded, e);
      sequential = {
        ...r.session,
        metrics: recomputeSessionMetrics(r.session),
      };
      expanded = r.expandedNodeIds;
    }

    const batched = reduceStreamEvents(emptySession(), new Set(), events);

    assert.equal(
      Object.keys(batched.session.nodes).sort().join(","),
      Object.keys(sequential.nodes).sort().join(",")
    );
    assert.equal(batched.session.metrics.toolCallCount, 1);
    assert.equal(batched.session.metrics.filesChanged, 1);
    assert.equal(sequential.metrics.toolCallCount, 1);
    assert.equal(sequential.metrics.filesChanged, 1);
    // Cumulative thinking should prefer fuller text
    const thought =
      batched.session.nodes["t1"] ??
      Object.values(batched.session.nodes).find((n) => n.type === "thinking");
    assert.ok(thought);
    assert.match(thought!.content || "", /First thoughts expanded/);
    assert.equal((batched.session.eventLog ?? []).length, events.length);
    assert.equal(batched.session.eventCount, events.length);
  });

  it("keeps distinct non-cumulative thoughts as separate nodes", () => {
    const events: StreamEvent[] = [
      ev({
        type: "thinking",
        id: "a",
        timestamp: 100,
        content: "Reading the roadmap",
        status: "running",
      }),
      ev({
        type: "thinking",
        id: "b",
        timestamp: 200,
        content: "Implementing the batcher",
        status: "running",
      }),
    ];
    const r = reduceStreamEvents(emptySession(), new Set(), events);
    const thoughts = Object.values(r.session.nodes).filter(
      (n) => n.type === "thinking" || n.type === "reasoning"
    );
    assert.equal(thoughts.length, 2);
  });
});

describe("stream-batch queue", () => {
  it("flushes queued events into the store in one apply", () => {
    clearStreamBatch();
    const id = useSpokStore.getState().createSession(
      { name: "batch-test", source: "import", durable: false },
      { activate: true }
    );

    const events: StreamEvent[] = [
      ev({
        type: "thinking",
        id: "bt1",
        timestamp: 1,
        content: "Hello",
        status: "running",
      }),
      ev({
        type: "thinking",
        id: "bt1",
        timestamp: 2,
        content: "Hello world",
        status: "running",
      }),
    ];

    enqueueStreamEvents(id, events);
    assert.ok(pendingStreamBatchCount() >= 2);
    flushStreamBatch();
    assert.equal(pendingStreamBatchCount(), 0);

    const session = useSpokStore.getState().sessions[id];
    assert.ok(session);
    const node = session.nodes["bt1"];
    assert.ok(node);
    assert.match(node.content || "", /Hello world/);
    assert.equal((session.eventLog ?? []).length, 2);

    useSpokStore.getState().deleteSession(id);
    clearStreamBatch();
  });
});
