/**
 * Review readiness — checklist + lifecycle projection (process / task / review).
 * Covers success, contradiction/diagnostic, and next-action paths.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationJob } from "../../src/lib/automation/types";
import { INBOX_LIFECYCLE_PRESENTATION_VERSION } from "../../src/lib/session-lifecycle-projection";
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

function job(
  partial: Partial<AutomationJob> & Pick<AutomationJob, "id">
): AutomationJob {
  return {
    kind: "background",
    title: "job",
    prompt: "do thing",
    cwd: "/repo",
    isolate: true,
    status: "queued",
    priority: 0,
    createdAt: 1,
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

  it("projects review-ready success with distinct process/review layers and next action toward handoff", () => {
    const r = buildReviewReadiness(
      baseSession({
        status: "completed",
        metrics: {
          ...baseSession().metrics,
          filesChanged: 2,
        },
        files: {
          f1: file({ id: "f1", path: "src/a.ts", staged: true }),
        },
        gitSummary: {
          branch: "feat/review",
          upstream: "origin/feat/review",
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

    assert.equal(r.lifecycleVersion, INBOX_LIFECYCLE_PRESENTATION_VERSION);
    assert.equal(r.lane, "ready_review");
    assert.equal(r.reviewReady, true);
    assert.equal(r.isDiagnostic, false);
    assert.equal(r.reasonSource, "review");
    // Process exit stays distinct from review readiness.
    assert.equal(r.processStatus, "completed");
    assert.equal(r.processLabel, "Process exited");
    assert.match(r.reviewLabel, /ready for review/i);
    assert.equal(r.readyToCommit, true);
    assert.equal(r.nextAction.id, "commit");
    assert.equal(r.nextAction.disabled, false);
    // Handoff is not claimed as already done.
    assert.notEqual(r.nextAction.id, "none");
  });

  it("never claims ready success when process and task outcomes contradict", () => {
    const session = baseSession({
      status: "completed",
      metrics: { ...baseSession().metrics, filesChanged: 1 },
      files: {
        f1: file({ id: "f1", path: "a.ts", staged: true }),
      },
      gitSummary: {
        branch: "feat",
        upstream: null,
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
        headOid: null,
        updatedAt: 1,
      },
    });
    const linked = job({
      id: "j-running",
      sessionId: session.id,
      status: "running",
    });
    const r = buildReviewReadiness(session, linked);

    assert.equal(r.isDiagnostic, true);
    assert.equal(r.reviewReady, false);
    assert.equal(r.readyToCommit, false);
    assert.equal(r.reasonSource, "diagnostic");
    assert.match(r.summary, /needs attention/i);
    assert.match(r.reason, /state mismatch/i);
    // Layers remain visible and distinct.
    assert.equal(r.processLabel, "Process exited");
    assert.equal(r.jobStatus, "running");
    assert.equal(r.taskLabel, "Running");
    assert.equal(r.nextAction.id, "inspect_state");
    assert.notEqual(r.summary.toLowerCase().includes("ready to commit"), true);
  });

  it("keeps process exit distinct from review readiness when finished with no review work", () => {
    const r = buildReviewReadiness(baseSession({ status: "completed" }));
    assert.equal(r.lane, "finished");
    assert.equal(r.reviewReady, false);
    assert.equal(r.processLabel, "Process exited");
    assert.match(r.reviewLabel, /not review-ready/i);
    assert.equal(r.isDiagnostic, false);
  });
});
