/**
 * Handoff flow — Git stages stay distinct from process / task / review layers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationJob } from "../../src/lib/automation/types";
import { buildHandoffFlow } from "../../src/lib/handoff-flow";
import { INBOX_LIFECYCLE_PRESENTATION_VERSION } from "../../src/lib/session-lifecycle-projection";
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

function job(
  partial: Partial<AutomationJob> & Pick<AutomationJob, "id">
): AutomationJob {
  return {
    kind: "background",
    title: "job",
    prompt: "do thing",
    cwd: "/worktree",
    isolate: true,
    status: "queued",
    priority: 0,
    createdAt: 1,
    ...partial,
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

  it("keeps process, task, review, and handoff stages distinct on review-ready success", () => {
    const flow = buildHandoffFlow(
      session({
        status: "completed",
        metrics: {
          startedAt: 1,
          endedAt: 2,
          elapsedMs: 1,
          toolCallCount: 0,
          thinkingSteps: 0,
          filesChanged: 2,
          linesAdded: 2,
          linesDeleted: 0,
          subagentCount: 0,
          errorCount: 0,
        },
        files: { f1: file({ staged: true }) },
        gitSummary: git({ stagedCount: 1, clean: false }),
      }),
      job({ id: "j-done", sessionId: "s1", status: "completed" })
    );

    assert.equal(
      flow.lifecycle.lifecycleVersion,
      INBOX_LIFECYCLE_PRESENTATION_VERSION
    );
    assert.equal(flow.lifecycle.isDiagnostic, false);
    assert.equal(flow.lifecycle.lane, "ready_review");
    assert.equal(flow.lifecycle.reviewReady, true);
    // Process layer ≠ review readiness ≠ handoff commit stage.
    assert.equal(flow.lifecycle.processLabel, "Process exited");
    assert.equal(flow.lifecycle.taskLabel, "Completed");
    assert.match(flow.lifecycle.reviewLabel, /ready for review/i);
    assert.match(flow.lifecycle.handoffLabel, /commit/i);
    assert.equal(flow.nextAction.id, "commit");
    // Git step rail is the handoff path, not process exit.
    assert.equal(flow.steps.find((s) => s.id === "commit")?.status, "active");
    assert.equal(flow.steps.find((s) => s.id === "review")?.status, "complete");
  });

  it("surfaces process vs task contradiction as diagnostic — never handoff success", () => {
    const s = session({
      status: "completed",
      metrics: {
        startedAt: 1,
        endedAt: 2,
        elapsedMs: 1,
        toolCallCount: 0,
        thinkingSteps: 0,
        filesChanged: 1,
        linesAdded: 1,
        linesDeleted: 0,
        subagentCount: 0,
        errorCount: 0,
      },
      files: { f1: file({ staged: true }) },
      gitSummary: git({ stagedCount: 1, clean: false }),
    });
    const flow = buildHandoffFlow(
      s,
      job({ id: "j-fail", sessionId: s.id, status: "failed", error: "exit 1" })
    );

    assert.equal(flow.lifecycle.isDiagnostic, true);
    assert.equal(flow.lifecycle.reasonSource, "diagnostic");
    assert.match(flow.headline, /needs attention/i);
    assert.match(flow.lifecycle.reason, /outcome mismatch/i);
    // Process and task remain distinct and visible.
    assert.equal(flow.lifecycle.processStatus, "completed");
    assert.equal(flow.lifecycle.jobStatus, "failed");
    assert.equal(flow.lifecycle.reviewReady, false);
    // No optimistic commit/push/PR.
    assert.equal(flow.nextAction.id, "review");
    assert.equal(flow.nextAction.label, "Inspect state");
    assert.notEqual(flow.nextAction.id, "commit");
    assert.notEqual(flow.nextAction.id, "push");
    assert.notEqual(flow.nextAction.id, "create_pr");
    for (const step of flow.steps) {
      assert.equal(step.status, "blocked");
    }
    // Handoff stage label is not success.
    assert.match(flow.lifecycle.handoffLabel, /diagnostic/i);
  });

  it("does not treat durable handoff outcome as review readiness or process exit", () => {
    const flow = buildHandoffFlow(
      session({
        status: "completed",
        handoffOutcome: {
          version: 1,
          id: "handoff-s1",
          sessionId: "s1",
          state: "committed",
          createdAt: 1,
          updatedAt: 2,
          readiness: {
            capturedAt: 2,
            sessionStatus: "completed",
            reviewIssueCount: 0,
            unresolvedComments: 0,
            validationTotal: 0,
            validationPassed: 0,
            validationFailed: 0,
            validationBlocked: 0,
            dirtyCount: 0,
            conflictCount: 0,
            ahead: 1,
            behind: 0,
            clean: true,
          },
          commit: { oid: "abc123def", recordedAt: 2 },
        },
        gitSummary: git({ ahead: 1, clean: true }),
      })
    );

    // Historical handoff evidence present.
    assert.equal(flow.outcome?.state, "committed");
    // Fresh next action still comes from Git state (push), not from process exit.
    assert.equal(flow.nextAction.id, "push");
    assert.equal(flow.lifecycle.processLabel, "Process exited");
    // Review readiness is not automatically true just because a commit was recorded.
    // Finished clean tree with ahead commits may be finished/ready_review depending on files.
    assert.ok(flow.lifecycle.handoffLabel);
    assert.notEqual(flow.lifecycle.handoffLabel, flow.lifecycle.processLabel);
    assert.notEqual(flow.lifecycle.handoffLabel, flow.lifecycle.reviewLabel);
  });
});
