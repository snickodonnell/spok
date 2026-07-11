import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReviewIssueMarkers,
  buildReviewQueue,
  nextReviewFileId,
  reviewQueueIndex,
} from "../../src/lib/review-queue";
import { buildReviewSummary } from "../../src/lib/review-summary";
import { buildValidationRecipes } from "../../src/lib/validation-recipes";
import type { FileDiff, Session, TraceNode } from "../../src/lib/types";

function baseSession(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "auth refactor",
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
    ...over,
  };
}

function file(
  partial: Partial<FileDiff> & Pick<FileDiff, "id" | "path">
): FileDiff {
  return {
    status: "modified",
    language: "ts",
    additions: 2,
    deletions: 1,
    hunks: [],
    relatedTraceIds: [],
    timestamp: 1,
    ...partial,
  };
}

describe("buildReviewQueue", () => {
  it("groups and orders files by risk", () => {
    const session = baseSession({
      files: {
        a: file({ id: "a", path: "src/app.ts", staged: true }),
        b: file({ id: "b", path: ".env", isSecret: true, unstaged: true }),
        c: file({ id: "c", path: "README.md", untracked: true }),
        d: file({ id: "d", path: "src/app.test.ts", staged: true }),
        e: file({ id: "e", path: "package.json", unstaged: true }),
      },
    });
    const q = buildReviewQueue(session);
    assert.equal(q.summary.total, 5);
    assert.ok(q.flat[0].path === ".env" || q.flat[0].risk.kind === "security");
    assert.ok(q.groups.some((g) => g.id === "security"));
    assert.ok(q.groups.some((g) => g.id === "config"));
    assert.ok(q.groups.some((g) => g.id === "source"));
    assert.ok(q.summary.needsAttention);
    assert.ok(q.summary.securityCount >= 1);
  });

  it("navigates next/prev in flat order", () => {
    const session = baseSession({
      files: {
        a: file({ id: "a", path: "src/a.ts" }),
        b: file({ id: "b", path: "src/b.ts" }),
        c: file({ id: "c", path: "src/c.ts" }),
      },
    });
    const q = buildReviewQueue(session);
    const first = q.flat[0].fileId;
    const second = nextReviewFileId(q, first, 1);
    assert.ok(second);
    assert.notEqual(second, first);
    assert.equal(nextReviewFileId(q, second, -1), first);
    assert.equal(reviewQueueIndex(q, first), 0);
  });

  it("emits issue markers for conflicts, secrets, comments, failures", () => {
    const failNode: TraceNode = {
      id: "n1",
      parentId: null,
      type: "tool_result",
      title: "npm test",
      content: "FAIL",
      timestamp: 10,
      children: [],
      links: [],
      depth: 0,
      status: "error",
      toolName: "npm test",
    };
    const session = baseSession({
      files: {
        c: file({ id: "c", path: "src/x.ts", conflict: true }),
        s: file({ id: "s", path: ".env.local", isSecret: true }),
      },
      nodes: { n1: failNode },
      rootTraceIds: ["n1"],
      reviewComments: [
        {
          id: "rc1",
          path: "src/x.ts",
          body: "Please fix",
          author: "user",
          createdAt: 5,
        },
      ],
    });
    const issues = buildReviewIssueMarkers(session);
    assert.ok(issues.some((i) => i.kind === "conflict"));
    assert.ok(issues.some((i) => i.kind === "secret"));
    assert.ok(issues.some((i) => i.kind === "comment"));
  });
});

describe("buildReviewSummary", () => {
  it("produces title and markdown body", () => {
    const session = baseSession({
      gitSummary: {
        branch: "feat/review",
        upstream: null,
        ahead: 1,
        behind: 0,
        stagedCount: 1,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictCount: 0,
        clean: false,
        isWorktree: false,
        mainWorktreePath: null,
        repoRoot: "/repo",
        headOid: null,
        updatedAt: 1,
      },
      files: {
        a: file({ id: "a", path: "src/lib/store.ts", staged: true, additions: 10, deletions: 2 }),
      },
    });
    const s = buildReviewSummary(session);
    assert.ok(s.title.length > 0);
    assert.ok(s.bodyMarkdown.includes("## Summary"));
    assert.ok(s.bodyMarkdown.includes("src/lib/store.ts"));
    assert.ok(s.clipboard.includes(s.title));
    assert.equal(s.stats.files, 1);
    assert.equal(s.stats.additions, 10);
  });
});

describe("buildValidationRecipes", () => {
  it("exposes build and slash catalog always", () => {
    const recipes = buildValidationRecipes(baseSession());
    assert.ok(recipes.find((r) => r.id === "build_workspace")?.available);
    assert.ok(recipes.find((r) => r.id === "slash_catalog")?.available);
    assert.equal(
      recipes.find((r) => r.id === "retest_failed")?.available,
      false
    );
  });

  it("enables test_touched when files exist", () => {
    const recipes = buildValidationRecipes(
      baseSession({
        files: {
          a: file({ id: "a", path: "packages/core/src/x.ts" }),
        },
      })
    );
    const t = recipes.find((r) => r.id === "test_touched");
    assert.ok(t?.available);
    assert.ok(t?.prompt.includes("packages/core"));
  });
});
