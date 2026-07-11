import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendNormalizedEvents,
  appendRawEnvelopes,
  createSessionOnDisk,
  deleteSessionOnDisk,
  listSessionMetas,
  readNormalizedEvents,
  readRawEnvelopes,
  readSessionMeta,
  writeSnapshot,
  readSnapshot,
} from "../../src/lib/session-store-fs";
import type { Session } from "../../src/lib/types";
import { replayEvents } from "../../src/lib/session-replay";

describe("session store filesystem", () => {
  let dir: string;
  const prev = process.env.SPOK_SESSIONS_DIR;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "spok-sessions-"));
    process.env.SPOK_SESSIONS_DIR = dir;
  });

  after(() => {
    if (prev === undefined) delete process.env.SPOK_SESSIONS_DIR;
    else process.env.SPOK_SESSIONS_DIR = prev;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("creates, appends, lists, and deletes sessions", () => {
    const id = "testsession01";
    const meta = createSessionOnDisk({
      id,
      name: "Test Session",
      status: "ready",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: "live",
      cwd: "C:\\dev\\demo",
      command: "grok",
    });
    assert.equal(meta.id, id);
    assert.equal(meta.eventCount, 0);

    const { appended, eventCount } = appendNormalizedEvents(id, [
      {
        version: 1,
        type: "system",
        timestamp: Date.now(),
        id: "e1",
        title: "Hello",
        content: "workspace ready",
        status: "success",
        provider: "spok",
      },
      {
        version: 1,
        type: "thinking",
        timestamp: Date.now(),
        id: "e2",
        title: "Thinking",
        content: "Bearer sk_live_abcdefghijklmnopqrstuv secret",
        status: "running",
        provider: "grok",
      },
    ]);
    assert.equal(appended, 2);
    assert.equal(eventCount, 2);

    const events = readNormalizedEvents(id);
    assert.equal(events.length, 2);
    // Secrets redacted on disk
    assert.ok(!events[1].content?.includes("sk_live_abcdefghijklmnopqrstuv"));
    assert.ok(events[1].content?.includes("[REDACTED]"));
    assert.ok(events[0].rawEventId);

    appendRawEnvelopes(id, [
      { kind: "stdout", data: "line one", timestamp: Date.now() },
    ]);
    const raw = readRawEnvelopes(id);
    assert.equal(raw.length, 1);

    const listed = listSessionMetas();
    assert.ok(listed.some((m) => m.id === id));
    assert.equal(readSessionMeta(id)?.eventCount, 2);

    // Snapshot + replay fidelity
    const session = replayEvents(events, {
      id,
      name: "Test Session",
      source: "resume",
      config: { cwd: "C:\\dev\\demo", command: "grok", args: [], autoScroll: true, playbackSpeed: 1 },
    });
    writeSnapshot(id, session as Session);
    const snap = readSnapshot(id);
    assert.ok(snap);
    assert.equal(snap!.id, id);

    assert.equal(deleteSessionOnDisk(id), true);
    assert.equal(readSessionMeta(id), null);
  });

  it("rejects invalid session ids (path traversal)", () => {
    assert.throws(() => {
      createSessionOnDisk({
        id: "../evil",
        name: "x",
        status: "ready",
        createdAt: 1,
        updatedAt: 1,
        source: "live",
        cwd: "",
        command: "grok",
      });
    });
  });

  it("writes lean compact snapshots and trims fat eventLog on read", () => {
    const id = "leansnapshot01";
    createSessionOnDisk({
      id,
      name: "Lean",
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
      source: "live",
      cwd: "/repo",
      command: "grok",
    });

    const hugeContent = "x".repeat(5000);
    const nodes: Session["nodes"] = {};
    for (let i = 0; i < 5; i++) {
      nodes[`n${i}`] = {
        id: `n${i}`,
        parentId: null,
        type: "thinking",
        title: `t${i}`,
        content: hugeContent,
        timestamp: i,
        children: [],
        links: [],
        depth: 0,
      };
    }
    const fatEvents = Array.from({ length: 80 }, (_, i) => ({
      version: 1 as const,
      type: "thinking" as const,
      timestamp: i,
      id: `e${i}`,
      title: "t",
      content: hugeContent,
      status: "success" as const,
      provider: "grok" as const,
    }));

    writeSnapshot(id, {
      id,
      name: "Lean",
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
      config: {
        cwd: "/repo",
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
        thinkingSteps: 5,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        subagentCount: 0,
        errorCount: 0,
      },
      rootTraceIds: ["n0"],
      nodes,
      files: {},
      fileTree: [],
      selectedTraceId: null,
      selectedFileId: null,
      timelineCursor: null,
      rawLog: [],
      source: "live",
      promptHistory: [],
      eventLog: fatEvents,
      eventCount: 80,
    });

    const snap = readSnapshot(id);
    assert.ok(snap);
    assert.ok((snap!.eventLog?.length ?? 0) <= 24);
    for (const n of Object.values(snap!.nodes)) {
      assert.ok((n.content?.length ?? 0) <= 1200);
    }

    // Compact on disk (no pretty multi-line indent for snapshot)
    const text = readFileSync(path.join(dir, id, "snapshot.json"), "utf8");
    assert.ok(!text.startsWith("{\n  "));
    assert.ok(text.length < 50_000);

    deleteSessionOnDisk(id);
  });
});
