import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHandoffFlow } from "../../src/lib/handoff-flow";
import type { FileDiff, Session, SessionGitSummary } from "../../src/lib/types";

function git(over: Partial<SessionGitSummary> = {}): SessionGitSummary {
  return {
    branch: "codex/handoff",
    upstream: "origin/codex/handoff",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    clean: true,
    isWorktree: true,
    mainWorktreePath: "/repo",
    repoRoot: "/worktree",
    headOid: "abc",
    updatedAt: 2,
    ...over,
  };
}

function file(over: Partial<FileDiff> = {}): FileDiff {
  return {
    id: "f1",
    path: "src/app.ts",
    status: "modified",
    language: "typescript",
    additions: 2,
    deletions: 1,
    hunks: [],
    relatedTraceIds: [],
    timestamp: 2,
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "Handoff",
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    config: {
      cwd: "/worktree",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
      isolationGuard: true,
      mainCheckout: "/repo",
      worktreePath: "/worktree",
    },
    metrics: {
      startedAt: 1,
      endedAt: 2,
      elapsedMs: 1,
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
    gitSummary: git(),
    ...over,
  };
}

describe("handoff flow", () => {
  it("moves reviewed staged work to the commit action", () => {
    const flow = buildHandoffFlow(
      session({
        files: { f1: file({ staged: true }) },
        gitSummary: git({ stagedCount: 1, clean: false }),
      })
    );
    assert.equal(flow.nextAction.id, "commit");
    assert.equal(flow.steps.find((step) => step.id === "review")?.status, "complete");
    assert.equal(flow.steps.find((step) => step.id === "commit")?.status, "active");
  });

  it("routes failed validation back to review instead of Git writes", () => {
    const flow = buildHandoffFlow(
      session({
        files: { f1: file({ staged: true }) },
        gitSummary: git({ stagedCount: 1, clean: false }),
        nodes: {
          test: {
            id: "test",
            parentId: null,
            type: "tool_call",
            title: "npm test",
            content: "exit code 1",
            timestamp: 2,
            status: "error",
            children: [],
            links: [],
            depth: 0,
            toolName: "npm test",
          },
        },
      })
    );
    assert.equal(flow.nextAction.id, "review");
    assert.equal(flow.steps[0].status, "active");
    assert.equal(flow.steps[1].status, "blocked");
  });

  it("recovers from review to push after a clean commit", () => {
    const flow = buildHandoffFlow(
      session({ gitSummary: git({ ahead: 1, clean: true }) })
    );
    assert.equal(flow.nextAction.id, "push");
    assert.equal(flow.steps.find((step) => step.id === "commit")?.status, "complete");
    assert.equal(flow.steps.find((step) => step.id === "push")?.status, "active");
  });

  it("offers a PR draft for a synchronized upstream branch", () => {
    const flow = buildHandoffFlow(
      session({
        handoffOutcome: {
          version: 1,
          id: "handoff-s1",
          sessionId: "s1",
          state: "published",
          createdAt: 1,
          updatedAt: 2,
          readiness: {
            capturedAt: 2,
            sessionStatus: "completed",
            reviewIssueCount: 0,
            unresolvedComments: 0,
            validationTotal: 1,
            validationPassed: 1,
            validationFailed: 0,
            validationBlocked: 0,
            dirtyCount: 0,
            conflictCount: 0,
            ahead: 0,
            behind: 0,
            clean: true,
          },
          push: { branch: "codex/handoff", recordedAt: 2 },
        },
      })
    );
    assert.equal(flow.nextAction.id, "create_pr");
    assert.equal(flow.steps.find((step) => step.id === "push")?.status, "complete");
    assert.equal(flow.steps.find((step) => step.id === "pr")?.status, "active");
    assert.equal(flow.outcome?.state, "published");
  });

  it("does not suggest a pull request for a clean default branch", () => {
    const flow = buildHandoffFlow(
      session({ gitSummary: git({ branch: "main", upstream: "origin/main" }) })
    );
    assert.equal(flow.nextAction.id, "none");
    assert.equal(flow.steps.find((step) => step.id === "pr")?.status, "pending");
  });

  it("does not enable handoff while an agent is running", () => {
    const flow = buildHandoffFlow(
      session({
        status: "running",
        files: { f1: file({ unstaged: true }) },
        gitSummary: git({ unstagedCount: 1, clean: false }),
      })
    );
    assert.equal(flow.nextAction.id, "wait");
    assert.equal(flow.nextAction.disabled, true);
    assert.equal(flow.steps[0].status, "blocked");
  });
});
