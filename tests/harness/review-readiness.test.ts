import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewReadiness } from "../../src/lib/review-readiness";
import type { FileDiff, Session } from "../../src/lib/types";

function baseSession(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "test",
    status: "ready",
    createdAt: 1,
    updatedAt: 1,
    config: { cwd: "/repo", command: "grok", args: [], autoScroll: true, playbackSpeed: 1 },
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

function file(partial: Partial<FileDiff> & Pick<FileDiff, "id" | "path">): FileDiff {
  return {
    status: "modified",
    language: "ts",
    additions: 1,
    deletions: 0,
    hunks: [],
    relatedTraceIds: [],
    timestamp: 1,
    ...partial,
  };
}

describe("review readiness", () => {
  it("blocks commit when nothing staged", () => {
    const r = buildReviewReadiness(
      baseSession({
        files: {
          f1: file({ id: "f1", path: "a.ts", unstaged: true }),
        },
      })
    );
    assert.equal(r.readyToCommit, false);
    assert.ok(r.items.some((i) => i.id === "staged" && i.blocksCommit));
  });

  it("is ready when staged and clean of blockers", () => {
    const r = buildReviewReadiness(
      baseSession({
        files: {
          f1: file({ id: "f1", path: "a.ts", staged: true }),
        },
        gitSummary: {
          branch: "main",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          stagedCount: 1,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictCount: 0,
          clean: false,
          isWorktree: false,
          mainWorktreePath: null,
          repoRoot: "/repo",
          headOid: "abc",
          updatedAt: 1,
        },
      })
    );
    assert.equal(r.readyToCommit, true);
    assert.equal(r.summary, "Ready to commit");
  });

  it("warns on unresolved review comments and secrets", () => {
    const r = buildReviewReadiness(
      baseSession({
        files: {
          f1: file({ id: "f1", path: ".env", staged: true, isSecret: true }),
        },
        reviewComments: [
          {
            id: "c1",
            path: ".env",
            body: "check this",
            author: "user",
            createdAt: 1,
          },
        ],
        gitSummary: {
          branch: "feat",
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
      })
    );
    assert.equal(r.readyToCommit, true);
    assert.equal(r.summary, "Ready with warnings");
    assert.equal(r.unresolvedComments, 1);
    assert.equal(r.secretFiles, 1);
  });

  it("blocks on conflicts and isolation guard", () => {
    const r = buildReviewReadiness(
      baseSession({
        config: {
          cwd: "/repo",
          command: "grok",
          args: [],
          autoScroll: true,
          playbackSpeed: 1,
          isolationGuard: true,
          mainCheckout: "/repo",
        },
        files: {
          f1: file({ id: "f1", path: "a.ts", staged: true, conflict: true }),
        },
        gitSummary: {
          branch: "main",
          upstream: null,
          ahead: 0,
          behind: 0,
          stagedCount: 1,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictCount: 1,
          clean: false,
          isWorktree: false,
          mainWorktreePath: null,
          repoRoot: "/repo",
          headOid: null,
          updatedAt: 1,
        },
      })
    );
    assert.equal(r.readyToCommit, false);
    assert.ok(r.items.some((i) => i.id === "conflicts" && i.blocksCommit));
    assert.ok(r.items.some((i) => i.id === "isolation" && i.blocksCommit));
  });
});
