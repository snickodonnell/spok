import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  usageToneFromRatio,
  usageToneStyles,
  estimateTokensFromText,
  extractProviderTokens,
  buildSessionUsage,
  formatTokenCount,
  peakTone,
  resolveContextLimit,
  DEFAULT_CONTEXT_LIMIT,
} from "../../src/lib/usage";
import type { Session } from "../../src/lib/types";

function baseSession(partial?: Partial<Session>): Session {
  return {
    id: "s1",
    name: "Test",
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
    config: {
      cwd: "/tmp",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: 1,
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
    ...partial,
  };
}

describe("usage tone thresholds", () => {
  it("maps ratios to escalating tones", () => {
    assert.equal(usageToneFromRatio(0.1), "calm");
    assert.equal(usageToneFromRatio(0.5), "notice");
    assert.equal(usageToneFromRatio(0.75), "caution");
    assert.equal(usageToneFromRatio(0.9), "warn");
    assert.equal(usageToneFromRatio(0.98), "critical");
    assert.equal(usageToneFromRatio(1.2), "critical");
  });

  it("assigns distinct bar colors per tone", () => {
    const colors = new Set(
      (["calm", "notice", "caution", "warn", "critical"] as const).map(
        (t) => usageToneStyles(t).bar
      )
    );
    assert.equal(colors.size, 5);
  });

  it("peaks to the most severe tone", () => {
    assert.equal(peakTone(["calm", "caution", "notice"]), "caution");
    assert.equal(peakTone(["warn", "critical"]), "critical");
  });
});

describe("token estimation and parsing", () => {
  it("estimates tokens from text length", () => {
    assert.equal(estimateTokensFromText(""), 0);
    assert.ok(estimateTokensFromText("abcd") >= 1);
    assert.equal(estimateTokensFromText("a".repeat(40)), 10);
  });

  it("formats counts compactly", () => {
    assert.equal(formatTokenCount(42), "42");
    assert.equal(formatTokenCount(1500), "1.5k");
    assert.equal(formatTokenCount(12_000), "12k");
  });

  it("extracts provider usage from meta shapes", () => {
    assert.equal(
      extractProviderTokens({ usage: { total_tokens: 900 } }),
      900
    );
    assert.equal(
      extractProviderTokens({
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      150
    );
    assert.equal(extractProviderTokens({ totalTokens: 42 }), 42);
    assert.equal(extractProviderTokens({}), null);
  });
});

describe("session usage snapshot", () => {
  it("builds context meter with default limit", () => {
    const session = baseSession({
      nodes: {
        n1: {
          id: "n1",
          parentId: null,
          type: "thinking",
          title: "Thought",
          content: "x".repeat(4000),
          timestamp: 1,
          children: [],
          links: [],
          depth: 0,
        },
      },
    });
    const snap = buildSessionUsage(session, {
      contextLimit: DEFAULT_CONTEXT_LIMIT,
    });
    assert.equal(snap.context.limit, DEFAULT_CONTEXT_LIMIT);
    assert.ok(snap.context.used >= 1000);
    assert.equal(snap.context.estimated, true);
    assert.equal(snap.context.tone, "calm");
    assert.ok(snap.context.percent >= 0);
  });

  it("shifts tone as usage nears custom limit", () => {
    const session = baseSession({
      promptHistory: [
        {
          id: "t1",
          text: "y".repeat(800), // ~200 tokens
          label: "p",
          timestamp: 1,
          status: "success",
        },
      ],
    });
    const snap = buildSessionUsage(session, { contextLimit: 250 });
    assert.ok(snap.context.ratio >= 0.75);
    assert.ok(
      ["caution", "warn", "critical"].includes(snap.context.tone),
      snap.context.tone
    );
  });

  it("includes turns meter when maxTurns is set", () => {
    const session = baseSession({
      grokFlags: { maxTurns: 5 },
      promptHistory: [
        {
          id: "a",
          text: "one",
          label: "one",
          timestamp: 1,
          status: "success",
        },
        {
          id: "b",
          text: "two",
          label: "two",
          timestamp: 2,
          status: "success",
        },
        {
          id: "c",
          text: "three",
          label: "three",
          timestamp: 3,
          status: "running",
        },
      ],
    });
    const snap = buildSessionUsage(session, { contextLimit: 128_000 });
    assert.ok(snap.turns);
    assert.equal(snap.turns!.used, 3);
    assert.equal(snap.turns!.limit, 5);
    assert.equal(snap.turns!.percent, 60);
    assert.equal(snap.turns!.tone, "notice");
  });

  it("prefers provider token totals when higher", () => {
    const session = baseSession({
      metrics: {
        startedAt: 1,
        endedAt: null,
        elapsedMs: 0,
        toolCallCount: 0,
        thinkingSteps: 0,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        subagentCount: 0,
        errorCount: 0,
        tokensEstimate: 50_000,
      },
    });
    const snap = buildSessionUsage(session, { contextLimit: 100_000 });
    assert.equal(snap.context.used, 50_000);
    assert.equal(snap.context.percent, 50);
    assert.equal(snap.context.tone, "notice");
  });
});

describe("resolveContextLimit", () => {
  it("honors settings, session, then env, then default", () => {
    assert.equal(resolveContextLimit({}), DEFAULT_CONTEXT_LIMIT);
    assert.equal(
      resolveContextLimit({ settingsLimit: 64_000 }),
      64_000
    );
    assert.equal(
      resolveContextLimit({ settingsLimit: 64_000, sessionLimit: 32_000 }),
      32_000
    );
    assert.equal(
      resolveContextLimit({
        settingsLimit: 64_000,
        sessionLimit: 32_000,
        envLimit: "200000",
      }),
      200_000
    );
  });
});
