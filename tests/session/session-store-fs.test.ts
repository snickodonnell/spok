import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
});
