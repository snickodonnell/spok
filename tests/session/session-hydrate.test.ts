import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  metaShellSession,
  rehydrateSessionFromEvents,
} from "../../src/lib/session-hydrate";
import { MAX_HOT_NODES } from "../../src/lib/session-reduce";
import type { Session, SessionMetaRecord, StreamEvent } from "../../src/lib/types";

describe("session hydrate helpers", () => {
  it("builds a partial meta shell without nodes", () => {
    const meta: SessionMetaRecord = {
      id: "abc123session",
      name: "Demo",
      status: "running",
      createdAt: 1,
      updatedAt: 2,
      source: "live",
      cwd: "C:\\dev\\spok",
      command: "grok",
      eventCount: 9000,
      rawCount: 100,
      formatVersion: 1,
    };
    const shell = metaShellSession(meta);
    assert.equal(shell.hydratePartial, true);
    assert.equal(shell.restoreState, "restoring");
    assert.equal(shell.status, "ready"); // never restore as running without process
    assert.equal(shell.eventCount, 9000);
    assert.equal(Object.keys(shell.nodes).length, 0);
    assert.equal(shell.config.cwd, "C:\\dev\\spok");
  });

  it("rehydrateSessionFromEvents rebuilds hot nodes from durable event evidence", () => {
    const base: Session = {
      id: "hydrate-recover",
      name: "Recover",
      status: "ready",
      createdAt: 1,
      updatedAt: 2,
      config: {
        cwd: "/tmp",
        command: "grok",
        args: [],
        autoScroll: true,
        playbackSpeed: 1,
      },
      metrics: {
        startedAt: 1,
        endedAt: 2,
        elapsedMs: 1,
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
      source: "resume",
      promptHistory: [],
      eventLog: [],
      durable: true,
      eventCount: 3,
      coldNodeCount: 0,
      restoreState: "available",
    };
    const events: StreamEvent[] = [
      {
        version: 1,
        type: "thinking",
        id: "h1",
        timestamp: 10,
        content: "one",
        status: "success",
      },
      {
        version: 1,
        type: "tool_call",
        id: "h2",
        timestamp: 20,
        content: "{}",
        toolName: "read",
        status: "running",
      },
      {
        version: 1,
        type: "thinking",
        id: "h3",
        timestamp: 30,
        content: "three",
        status: "success",
      },
    ];
    const session = rehydrateSessionFromEvents(base, events);
    assert.equal(session.restoreState, "available");
    assert.ok(session.nodes["h1"]);
    assert.ok(session.nodes["h2"]);
    assert.ok(session.nodes["h3"]);
    assert.equal(session.metrics.toolCallCount, 1);
    assert.equal(session.metrics.thinkingSteps, 2);
    assert.ok(Object.keys(session.nodes).length <= MAX_HOT_NODES);
  });
});
