import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STREAM_EVENT_SCHEMA_VERSION,
  makeParserErrorEvent,
  makeUnknownEvent,
  migrateStreamEvents,
  normalizeTimestamp,
  parseStreamEvent,
  stampStreamEvent,
} from "../../src/lib/stream-event-schema";

describe("stream event schema", () => {
  it("stamps version, id, and provider", () => {
    const ev = stampStreamEvent({
      type: "thinking",
      timestamp: 1700000000, // seconds
      content: "hello",
    });
    assert.equal(ev.version, STREAM_EVENT_SCHEMA_VERSION);
    assert.ok(ev.id);
    assert.equal(ev.provider, "spok");
    assert.ok(ev.timestamp > 1e12, "seconds should become ms");
  });

  it("normalizeTimestamp handles ms and seconds", () => {
    assert.equal(normalizeTimestamp(1_700_000_000_000), 1_700_000_000_000);
    assert.equal(normalizeTimestamp(1_700_000_000), 1_700_000_000_000);
  });

  it("parses valid events and rejects garbage", () => {
    const ok = parseStreamEvent({
      type: "tool_call",
      timestamp: Date.now(),
      toolName: "read",
      title: "Tool: read",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.event.type, "tool_call");
      assert.equal(ok.event.version, STREAM_EVENT_SCHEMA_VERSION);
    }

    const bad = parseStreamEvent({ foo: 1 });
    assert.equal(bad.ok, false);
  });

  it("makeUnknownEvent preserves raw payload", () => {
    const raw = { unexpected: true, nested: { a: 1 } };
    const ev = makeUnknownEvent({
      summary: "{ unexpected, nested }",
      raw,
      provider: "unknown",
    });
    assert.equal(ev.type, "system");
    assert.equal(ev.meta?.unknown, true);
    assert.deepEqual(ev.meta?.raw, raw);
  });

  it("makeParserErrorEvent marks severity parser", () => {
    const ev = makeParserErrorEvent({
      message: "broken line",
      raw: "{not json",
    });
    assert.equal(ev.type, "parser_error");
    assert.equal(ev.severity, "parser");
    assert.equal(ev.status, "error");
  });

  it("migrateStreamEvents recovers soft shapes and reports errors", () => {
    const { events, errors } = migrateStreamEvents([
      {
        type: "message",
        timestamp: Date.now(),
        content: "ok",
      },
      { type: "thinking", content: "legacy without timestamp" },
      null,
      "not-an-object",
    ]);
    assert.ok(events.length >= 2);
    assert.ok(errors.length >= 1);
    assert.ok(events.every((e) => e.version === STREAM_EVENT_SCHEMA_VERSION || e.provider));
  });
});
