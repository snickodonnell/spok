import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyEventToSession,
  createEmptySession,
  eventsFromSnapshotNodes,
  replayEvents,
} from "../../src/lib/session-replay";
import type { StreamEvent } from "../../src/lib/types";
import { parseImportPayload, buildExportPayload } from "../../src/lib/export-session";

describe("session replay", () => {
  it("rebuilds trace nodes and file diffs from ordered events", () => {
    const events: StreamEvent[] = [
      {
        version: 1,
        type: "goal",
        timestamp: 1000,
        id: "g1",
        title: "You",
        content: "Fix the bug",
        status: "success",
        provider: "spok",
      },
      {
        version: 1,
        type: "thinking",
        timestamp: 1100,
        id: "t1",
        title: "Thinking",
        content: "I will read the file",
        status: "running",
        provider: "grok",
      },
      {
        version: 1,
        type: "thinking",
        timestamp: 1200,
        id: "t1",
        title: "Thinking",
        content: "I will read the file carefully",
        status: "success",
        provider: "grok",
      },
      {
        version: 1,
        type: "tool_call",
        timestamp: 1300,
        id: "tc1",
        title: "Tool: read",
        toolName: "read",
        content: "{}",
        status: "running",
        meta: { toolCallId: "call_1" },
        provider: "grok",
      },
      {
        version: 1,
        type: "tool_result",
        timestamp: 1400,
        id: "tc1",
        title: "Result: read",
        toolName: "read",
        content: "done",
        status: "success",
        meta: { toolCallId: "call_1" },
        provider: "grok",
      },
      {
        version: 1,
        type: "file_change",
        timestamp: 1500,
        id: "f1",
        path: "src/app.ts",
        title: "File: src/app.ts",
        content: "modified src/app.ts",
        oldContent: "old\n",
        newContent: "new\n",
        diffStatus: "modified",
        status: "success",
        provider: "grok",
      },
    ];

    const session = replayEvents(events, {
      id: "sess_test_1",
      name: "Replay test",
      source: "import",
      status: "completed",
    });

    assert.ok(session.nodes["t1"]);
    assert.match(session.nodes["t1"].content, /carefully/);
    assert.equal(session.nodes["tc1"].status, "success");
    assert.ok(Object.values(session.files).some((f) => f.path === "src/app.ts"));
    assert.ok(session.metrics.toolCallCount >= 1);
    assert.ok(session.metrics.filesChanged >= 1);
    assert.ok(session.metrics.thinkingSteps >= 1);
  });

  it("applyEventToSession is idempotent for same id updates", () => {
    let s = createEmptySession({ id: "s2", name: "id" });
    s = applyEventToSession(s, {
      type: "message",
      timestamp: 1,
      id: "m1",
      content: "a",
      title: "Grok",
    });
    s = applyEventToSession(s, {
      type: "message",
      timestamp: 2,
      id: "m1",
      content: "ab",
      title: "Grok",
    });
    assert.equal(Object.keys(s.nodes).length, 1);
    assert.equal(s.nodes["m1"].content, "ab");
  });

  it("round-trips v2 export with event replay", () => {
    const events: StreamEvent[] = [
      {
        version: 1,
        type: "system",
        timestamp: 10,
        id: "sys1",
        title: "Harness",
        content: "start",
        status: "success",
        provider: "harness",
      },
      {
        version: 1,
        type: "message",
        timestamp: 20,
        id: "msg1",
        title: "Grok",
        content: "hello world",
        status: "success",
        provider: "grok",
      },
    ];
    const session = replayEvents(events, {
      id: "export_sess",
      name: "Export",
      source: "live",
    });
    session.eventLog = events;

    const payload = buildExportPayload(session);
    assert.equal(payload.version, 2);
    assert.ok(payload.events.length >= 1);

    const imported = parseImportPayload(payload);
    assert.equal(imported.formatVersion, 2);
    assert.equal(imported.fromEvents, true);

    const rebuilt = replayEvents(imported.events, {
      id: imported.session.id,
      name: imported.session.name,
      source: "import",
    });
    assert.ok(rebuilt.nodes["msg1"] || Object.values(rebuilt.nodes).some((n) => n.content.includes("hello")));
  });

  it("migrates v1 snapshot via eventsFromSnapshotNodes", () => {
    const session = replayEvents(
      [
        {
          type: "thinking",
          timestamp: 1,
          id: "th1",
          title: "Thinking",
          content: "plan",
          status: "success",
        },
      ],
      { id: "v1sess", name: "v1" }
    );
    // Strip event log to simulate v1
    session.eventLog = undefined;
    const recovered = eventsFromSnapshotNodes(session);
    assert.ok(recovered.length >= 1);
    assert.equal(recovered[0].id, "th1");

    const v1Payload = {
      version: 1 as const,
      exportedAt: Date.now(),
      session,
    };
    const parsed = parseImportPayload(v1Payload);
    assert.equal(parsed.formatVersion, 1);
    assert.ok(parsed.events.length >= 1);
  });
});
