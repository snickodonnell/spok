import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GrokStreamIngestor } from "../../src/lib/grok-stream";
import { parseNdjsonLine } from "../../src/lib/parser";
import { parseUnifiedDiff, createFileDiff } from "../../src/lib/diff-utils";

const fixturesDir = path.join(process.cwd(), "tests", "fixtures", "grok");

function readFixtureLines(name: string): string[] {
  const raw = readFileSync(path.join(fixturesDir, name), "utf8");
  return raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

describe("GrokStreamIngestor ACP fixtures", () => {
  it("coalesces thought and message chunks", () => {
    const ingest = new GrokStreamIngestor("C:\\dev\\demo");
    const lines = readFixtureLines("acp-thought-message.jsonl");
    const all = lines.flatMap((line) => ingest.ingestLine(line, 1).events);

    const thoughts = all.filter((e) => e.type === "thinking");
    const messages = all.filter((e) => e.type === "message");

    assert.ok(thoughts.length >= 1);
    assert.ok(messages.length >= 1);
    // last thought should contain both chunks
    const lastThought = thoughts[thoughts.length - 1];
    assert.match(lastThought.content ?? "", /package\.json/);
    assert.match(lastThought.content ?? "", /inspect/i);

    const lastMessage = messages[messages.length - 1];
    assert.match(lastMessage.content ?? "", /dependencies/i);
  });

  it("links tool_call to tool_result via provider id", () => {
    const ingest = new GrokStreamIngestor("/repo");
    const lines = readFixtureLines("acp-tool-call-result.jsonl");
    const all = lines.flatMap((line) => ingest.ingestLine(line, 2).events);

    const call = all.find((e) => e.type === "tool_call");
    const result = all.find((e) => e.type === "tool_result");
    assert.ok(call, "expected tool_call");
    assert.ok(result, "expected tool_result");
    assert.equal(call!.id, result!.id);
    assert.equal(result!.status, "success");
    assert.equal(call!.toolName?.toLowerCase(), "read");
  });

  it("parses harness stdout/stderr/event/exit envelopes", () => {
    const ingest = new GrokStreamIngestor("/repo");
    const lines = readFixtureLines("harness-envelopes.jsonl");
    const results = lines.map((line) => ingest.ingestLine(line, 3));

    const stdoutEvents = results[0].events;
    assert.ok(stdoutEvents.some((e) => e.type === "message"));
    assert.ok(results[1].logLine?.includes("stderr"));
    assert.equal(results[2].events[0]?.type, "system");
    assert.equal(results[3].events[0]?.type, "system");
    assert.match(results[3].events[0]?.content ?? "", /code 0/);
  });

  it("handles native events, unknown JSON, and plain text", () => {
    const ingest = new GrokStreamIngestor("/repo");
    const lines = readFixtureLines("unknown-and-native.jsonl");
    const r0 = ingest.ingestLine(lines[0], 4);
    assert.equal(r0.events[0]?.type, "thinking");
    assert.equal(r0.events[0]?.version, 1);
    assert.ok(r0.events[0]?.provider);

    const r1 = ingest.ingestLine(lines[1], 4);
    assert.equal(r1.events[0]?.type, "system");
    assert.ok(r1.events[0]?.meta);
    // Unknown JSON preserved under meta.raw
    assert.ok(r1.events[0]?.meta?.raw || r1.events[0]?.meta?.unknown);

    const r2 = ingest.ingestLine(lines[2], 4);
    assert.equal(r2.events[0]?.type, "message");
    assert.match(r2.events[0]?.content ?? "", /plain text/);
  });

  it("preserves unknown ACP-adjacent JSON with rawEventId", () => {
    const ingest = new GrokStreamIngestor("/repo");
    const lines = readFixtureLines("parser-error-unknown.jsonl");
    const all = lines.flatMap((l) => ingest.ingestLine(l, 5).events);
    assert.ok(all.some((e) => e.type === "thinking"));
    const unknown = all.find((e) => e.meta?.unknown || e.title?.includes("Unknown"));
    assert.ok(unknown, "expected unknown event");
    assert.ok(unknown!.rawEventId || unknown!.meta?.raw);
    assert.ok(all.every((e) => e.version === 1));
  });
});

describe("parser + diff smoke", () => {
  it("parses native NDJSON stream events", () => {
    const line = JSON.stringify({
      type: "tool_call",
      title: "Tool: write",
      content: "writing file",
      toolName: "write",
      path: "src/a.ts",
    });
    const ev = parseNdjsonLine(line, 10);
    assert.ok(ev);
    assert.equal(ev!.type, "tool_call");
    assert.equal(ev!.toolName, "write");
  });

  it("parses a minimal unified diff and creates FileDiff", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 111..222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,2 @@",
      " line1",
      "-old",
      "+new",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    assert.ok(files.length >= 1);
    assert.equal(files[0].path, "foo.ts");
    assert.ok(files[0].additions >= 1);
    assert.ok(files[0].deletions >= 1);

    const created = createFileDiff({
      path: "bar.ts",
      oldContent: "a\n",
      newContent: "b\n",
      status: "modified",
    });
    assert.equal(created.path, "bar.ts");
    assert.ok(created.hunks.length >= 0);
  });
});
