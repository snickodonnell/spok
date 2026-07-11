/**
 * Dogfood: reduce the auth-refactor sample and assert the review queue
 * surfaces risk groups, summaries, and hunk causality.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authRefactorEvents, authRefactorMeta } from "../../src/lib/samples/auth-refactor";
import { focusReviewWorkbench } from "../../src/lib/samples/focus-review";
import { reduceStreamEvents } from "../../src/lib/session-reduce";
import { buildReviewQueue } from "../../src/lib/review-queue";
import { buildReviewSummary } from "../../src/lib/review-summary";
import { getCausalStepsForHunk, getCausalStepsForFile } from "../../src/lib/causal-links";
import { classifyFileRisk } from "../../src/lib/file-risk";
import type { Session } from "../../src/lib/types";

function emptySession(): Session {
  return {
    id: "dogfood-auth",
    name: authRefactorMeta.name,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    config: {
      cwd: "/demo",
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
    source: "sample",
    promptHistory: [],
  };
}

describe("review queue dogfood (auth sample)", () => {
  it("reduces sample into multi-risk review queue", () => {
    const { session } = reduceStreamEvents(
      emptySession(),
      new Set(),
      authRefactorEvents
    );

    const files = Object.values(session.files);
    assert.ok(files.length >= 7, `expected many files, got ${files.length}`);

    const queue = buildReviewQueue(session);
    assert.ok(queue.summary.total >= 7);
    const groupIds = new Set(queue.groups.map((g) => g.id));
    assert.ok(groupIds.has("source") || groupIds.has("test"));
    assert.ok(
      groupIds.has("config") ||
        files.some((f) => classifyFileRisk(f.path, f).kind === "config"),
      "package.json should classify as config"
    );
    assert.ok(
      files.some((f) => f.path === ".env.example" || f.path.includes(".env")),
      "env example should be present for security group dogfood"
    );

    // Security-sensitive path should rank early in the flat queue
    const envIdx = queue.flat.findIndex((i) => i.path.includes(".env"));
    if (envIdx >= 0) {
      assert.ok(envIdx <= 2, "security paths should appear near the front of the queue");
    }

    const summary = buildReviewSummary(session);
    assert.ok(summary.bodyMarkdown.includes("## Summary"));
    assert.ok(summary.stats.files >= 7);
  });

  it("links file_change nodes with per-hunk TraceLinks", () => {
    const { session } = reduceStreamEvents(
      emptySession(),
      new Set(),
      authRefactorEvents
    );

    const fileChanges = Object.values(session.nodes).filter(
      (n) => n.type === "file_change"
    );
    assert.ok(fileChanges.length >= 5);
    const withHunkLinks = fileChanges.filter((n) =>
      n.links.some((l) => l.kind === "hunk")
    );
    assert.ok(
      withHunkLinks.length >= 1,
      "file_change nodes should carry hunk links after reduce"
    );

    // Pick a multi-hunk file if present; else any file with hunks
    const multi = Object.values(session.files).find((f) => f.hunks.length >= 1);
    assert.ok(multi);
    const fileBundle = getCausalStepsForFile(session, multi!.id);
    assert.ok(fileBundle && fileBundle.steps.length > 0);

    const hunkBundle = getCausalStepsForHunk(session, multi!.id, 0);
    assert.ok(hunkBundle);
    assert.equal(hunkBundle!.hunkIndex, 0);
    assert.ok(hunkBundle!.newLineStart >= 1);
    assert.ok(
      hunkBundle!.hunkSteps.length + hunkBundle!.broaderSteps.length > 0
    );
  });

  it("focusReviewWorkbench selects top risk file", () => {
    const { session } = reduceStreamEvents(
      emptySession(),
      new Set(),
      authRefactorEvents
    );

    let selected: string | null = null;
    let tab = "events";
    let mode = "run";
    let causal = false;

    const result = focusReviewWorkbench(
      {
        sessions: { [session.id]: session },
        setWorkspaceRightTab: (t) => {
          tab = t;
        },
        setViewMode: () => undefined,
        setProductMode: (m) => {
          mode = m;
        },
        setCausalDrawerOpen: (o) => {
          causal = o;
        },
        selectFile: (id) => {
          selected = id;
        },
      },
      session.id
    );

    assert.equal(tab, "changes");
    assert.equal(mode, "review");
    assert.equal(causal, true);
    assert.ok(result.fileId);
    assert.equal(selected, result.fileId);
    assert.ok(result.headline.length > 0);
  });
});
