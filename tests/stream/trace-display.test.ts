import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrokStreamIngestor } from "../../src/lib/grok-stream";
import {
  cleanThoughtText,
  collectThoughtBlocks,
  formatThoughtProse,
  isProgressStatusMessage,
  isStreamingContinuation,
  isSystemPromptNoise,
  isTechnicalCliNoise,
  mergeStreamingText,
  preferFullerText,
} from "../../src/lib/trace-text";
import type { TraceNode } from "../../src/lib/types";
import { authRefactorEvents } from "../../src/lib/samples/auth-refactor";

describe("thinking classification", () => {
  it("rejects system prompts and key-list noise", () => {
    assert.equal(isSystemPromptNoise("SYSTEM PROMPT\nYou are Grok..."), true);
    assert.equal(
      isSystemPromptNoise("I should inspect the package.json first."),
      false
    );
  });

  it("classifies git/cli technical output as noise", () => {
    assert.equal(
      isTechnicalCliNoise(
        "3 files changed, 691 insertions(+), 5472 deletions(-)"
      ),
      true
    );
    assert.equal(
      isTechnicalCliNoise("[main a1b2c3d] Complete the next phase"),
      true
    );
    assert.equal(
      isTechnicalCliNoise(
        "I should stage the git changes and write a clear commit message."
      ),
      false
    );
  });

  it("recognizes permanent progress status messages", () => {
    assert.equal(
      isProgressStatusMessage(
        "The user wants me to complete the next phase on the roadmap."
      ),
      true
    );
    assert.equal(
      isProgressStatusMessage("Reading the roadmap and relevant skills."),
      true
    );
    assert.equal(
      isProgressStatusMessage(
        "Ran into an issue with the tests, doing a quick pass to check and fix."
      ),
      true
    );
    assert.equal(
      isProgressStatusMessage(
        "3 files changed, 10 insertions(+), 2 deletions(-)"
      ),
      false
    );
  });

  it("strips technical lines from mixed thought blobs", () => {
    const cleaned = cleanThoughtText(
      [
        "I will commit the Phase 3 work next.",
        "3 files changed, 10 insertions(+), 2 deletions(-)",
        "Then push to origin.",
      ].join("\n")
    );
    assert.match(cleaned, /commit the Phase 3/);
    assert.doesNotMatch(cleaned, /files changed/);
  });
});

describe("streaming continuation", () => {
  it("detects cumulative and delta continuations", () => {
    assert.equal(isStreamingContinuation("I should", "I should inspect"), true);
    assert.equal(isStreamingContinuation("Hello", " world"), true);
    assert.equal(isStreamingContinuation("Hel", "lo"), true);
    assert.equal(
      isStreamingContinuation(
        "Reading the roadmap.",
        "Ran into an issue with the parser."
      ),
      false
    );
  });

  it("mergeStreamingText handles cumulative snapshots", () => {
    let t = "";
    t = mergeStreamingText(t, "I");
    t = mergeStreamingText(t, "I should");
    t = mergeStreamingText(t, "I should inspect the package.json first.");
    assert.equal(t, "I should inspect the package.json first.");
  });

  it("preferFullerText never shrinks a thought", () => {
    assert.equal(
      preferFullerText("I", "I should inspect the package.json first."),
      "I should inspect the package.json first."
    );
  });

  it("formatThoughtProse breaks run-on sentences", () => {
    const formatted = formatThoughtProse(
      "I will inspect the repo first. Next I will stage the changes. Then I will push."
    );
    assert.match(formatted, /\n/);
  });
});

describe("permanent thinking segments", () => {
  it("keeps distinct progress thoughts permanent (not cleared)", () => {
    const nodes: Record<string, TraceNode> = {
      a: {
        id: "a",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content:
          "The user wants me to complete the next phase on the roadmap.",
        timestamp: 1,
        children: [],
        links: [],
        depth: 0,
      },
      b: {
        id: "b",
        parentId: null,
        type: "message",
        title: "Progress",
        content: "Reading the roadmap and relevant skills.",
        timestamp: 2,
        children: [],
        links: [],
        depth: 0,
      },
      c: {
        id: "c",
        parentId: null,
        type: "message",
        title: "Progress",
        content:
          "Ran into an issue with the tests, doing a quick pass to check and fix.",
        timestamp: 3,
        children: [],
        links: [],
        depth: 0,
      },
    };
    const blocks = collectThoughtBlocks(nodes, undefined);
    assert.ok(blocks.length >= 3, `expected 3+ permanent blocks, got ${blocks.length}`);
    const joined = blocks.map((b) => b.text).join("\n---\n");
    assert.match(joined, /user wants me/);
    assert.match(joined, /Reading the roadmap/);
    assert.match(joined, /Ran into an issue/);
    // All progress — no summary kind required
    assert.ok(blocks.every((b) => b.kind === "progress" || b.kind === "summary"));
  });

  it("shows final summary after permanent progress", () => {
    const nodes: Record<string, TraceNode> = {
      p: {
        id: "p",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content: "I will implement the remaining Git panel polish now.",
        timestamp: 1,
        children: [],
        links: [],
        depth: 0,
      },
      s: {
        id: "s",
        parentId: null,
        type: "message",
        title: "Grok",
        content:
          "Phase 3 is complete. The Git panel supports stage, commit, worktrees, and review comments with confirmations.",
        timestamp: 99,
        children: [],
        links: [],
        depth: 0,
        status: "success",
      },
    };
    const blocks = collectThoughtBlocks(nodes, undefined);
    assert.ok(blocks.some((b) => b.kind === "progress"));
    const summary = blocks.find((b) => b.kind === "summary");
    assert.ok(summary);
    assert.match(summary!.text, /Phase 3 is complete/);
  });

  it("excludes git stats and tools from permanent thinking", () => {
    const nodes: Record<string, TraceNode> = {
      th: {
        id: "th",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content: "I will refactor the middleware carefully.",
        timestamp: 1,
        children: [],
        links: [],
        depth: 0,
      },
      m1: {
        id: "m1",
        parentId: null,
        type: "message",
        title: "Grok",
        content: "3 files changed, 10 insertions(+), 2 deletions(-)",
        timestamp: 2,
        children: [],
        links: [],
        depth: 0,
      },
      t1: {
        id: "t1",
        parentId: null,
        type: "tool_call",
        title: "read_file",
        content: "read_file src/x.ts",
        timestamp: 3,
        children: [],
        links: [],
        depth: 0,
      },
    };
    const blocks = collectThoughtBlocks(nodes, undefined);
    const joined = blocks.map((b) => b.text).join("\n");
    assert.match(joined, /refactor the middleware/);
    assert.doesNotMatch(joined, /files changed/);
    assert.doesNotMatch(joined, /read_file/);
  });

  it("collapses cumulative snapshots of the same segment", () => {
    const nodes: Record<string, TraceNode> = {
      a: {
        id: "a",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content: "I",
        timestamp: 1,
        children: [],
        links: [],
        depth: 0,
      },
      b: {
        id: "b",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content: "I should inspect",
        timestamp: 2,
        children: [],
        links: [],
        depth: 0,
      },
      c: {
        id: "c",
        parentId: null,
        type: "thinking",
        title: "Thinking",
        content: "I should inspect the package.json first.",
        timestamp: 3,
        children: [],
        links: [],
        depth: 0,
      },
    };
    const blocks = collectThoughtBlocks(nodes, undefined);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, "I should inspect the package.json first.");
  });

  it("shows sample auth-refactor thinking without tools", () => {
    const nodes: Record<string, TraceNode> = {};
    for (const ev of authRefactorEvents) {
      if (ev.type !== "thinking" && ev.type !== "reasoning") continue;
      if (!ev.id) continue;
      nodes[ev.id] = {
        id: ev.id,
        parentId: ev.parentId ?? null,
        type: "thinking",
        title: ev.title || "Thinking",
        content: ev.content || "",
        summary: ev.summary,
        timestamp: ev.timestamp,
        children: [],
        links: [],
        depth: 0,
        status: ev.status,
      };
    }
    const blocks = collectThoughtBlocks(nodes, authRefactorEvents);
    assert.ok(blocks.length >= 1);
    const joined = blocks.map((b) => b.text).join("\n");
    assert.match(joined, /auth/i);
    assert.doesNotMatch(joined, /list_dir/);
  });

  it("ingestor seals previous progress when a new status line replaces it", () => {
    const ingest = new GrokStreamIngestor("/repo");
    const msg = (text: string) =>
      JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        },
      });

    const r1 = ingest.ingestLine(
      msg("Reading the roadmap and relevant skills."),
      1
    );
    const running1 = r1.events.find((e) => e.type === "message");
    assert.ok(running1);
    assert.match(running1!.content ?? "", /Reading the roadmap/);

    // Non-continuation status → seal previous as permanent, start new
    const r2 = ingest.ingestLine(
      msg("Ran into an issue with the tests, fixing now."),
      2
    );
    const sealed = r2.events.filter((e) => e.type === "message");
    assert.ok(sealed.length >= 2, "expected sealed + new message events");
    const texts = sealed.map((e) => e.content ?? "").join("\n");
    assert.match(texts, /Reading the roadmap/);
    assert.match(texts, /Ran into an issue/);
  });

  it("maps raw Grok type=thought / type=text into thinking panel events", () => {
    const ingest = new GrokStreamIngestor("/repo");
    // This is the shape users see as bare "thought" / "text" in the raw log
    // when previously mis-routed to system events.
    const r1 = ingest.ingestLine(
      JSON.stringify({
        type: "thought",
        text: "The user wants me to fix the thinking panel.",
      }),
      1
    );
    assert.equal(r1.events[0]?.type, "thinking", "type=thought must become thinking");
    assert.match(r1.events[0]?.content ?? "", /thinking panel/);

    const r2 = ingest.ingestLine(
      JSON.stringify({
        type: "text",
        text: "Reading the stream parser next.",
      }),
      2
    );
    // May seal prior thought first, then emit message
    const msgEv = r2.events.find((e) => e.type === "message");
    assert.ok(msgEv, "type=text becomes message/progress");
    assert.match(msgEv!.content ?? "", /stream parser/);

    // End-to-end: these must surface in collectThoughtBlocks
    const nodes: Record<string, TraceNode> = {};
    for (const ev of [...r1.events, ...r2.events]) {
      if (!ev.id) continue;
      if (ev.type !== "thinking" && ev.type !== "message") continue;
      nodes[ev.id] = {
        id: ev.id,
        parentId: null,
        type: ev.type === "thinking" ? "thinking" : "message",
        title: ev.title || "",
        content: ev.content || "",
        timestamp: ev.timestamp,
        children: [],
        links: [],
        depth: 0,
      };
    }
    const blocks = collectThoughtBlocks(nodes, [...r1.events, ...r2.events]);
    assert.ok(blocks.length >= 1, "thinking panel must not be empty");
    const joined = blocks.map((b) => b.text).join("\n");
    assert.match(joined, /thinking panel/);
    assert.match(joined, /stream parser/i);
  });
});


