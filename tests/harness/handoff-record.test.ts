import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceHandoffOutcome,
  captureHandoffReadiness,
} from "../../src/lib/handoff-record";
import type { Session } from "../../src/lib/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-handoff",
    name: "Durable handoff",
    status: "completed",
    createdAt: 1,
    updatedAt: 2,
    config: {
      cwd: "C:\\repo-spok",
      mainCheckout: "C:\\repo",
      worktreePath: "C:\\repo-spok",
      isolationGuard: true,
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: 1,
      endedAt: 2,
      elapsedMs: 1,
      toolCallCount: 1,
      thinkingSteps: 0,
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      subagentCount: 0,
      errorCount: 0,
    },
    rootTraceIds: ["test"],
    nodes: {
      test: {
        id: "test",
        parentId: null,
        type: "tool_call",
        title: "npm test",
        content: "All tests passed",
        timestamp: 2,
        status: "success",
        children: [],
        links: [],
        depth: 0,
        toolName: "npm test",
      },
    },
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: "live",
    promptHistory: [],
    gitSummary: {
      branch: "spok/handoff",
      upstream: "origin/spok/handoff",
      ahead: 1,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      clean: true,
      isWorktree: true,
      mainWorktreePath: "C:\\repo",
      repoRoot: "C:\\repo-spok",
      headOid: "abc123def456",
      updatedAt: 2,
    },
    ...overrides,
  };
}

describe("durable handoff outcome", () => {
  it("captures review, validation, and Git readiness without raw output", () => {
    const readiness = captureHandoffReadiness(session(), 10);
    assert.equal(readiness.capturedAt, 10);
    assert.ok(readiness.validationPassed >= 1);
    assert.equal(readiness.reviewIssueCount, 0);
    assert.equal(readiness.headOid, "abc123def456");
  });

  it("preserves commit, push, and PR evidence with durable identity", () => {
    const initial = session();
    const committed = advanceHandoffOutcome({
      session: initial,
      jobId: "job-123",
      event: {
        action: "commit",
        ok: true,
        recordedAt: 10,
        auditId: "audit-commit",
        commit: { oid: "abc123def456", summary: "Ship handoff record" },
      },
    });
    const pushed = advanceHandoffOutcome({
      session: { ...initial, handoffOutcome: committed },
      jobId: "job-123",
      event: {
        action: "push",
        ok: true,
        recordedAt: 20,
        auditId: "audit-push",
        push: { remote: "origin", branch: "spok/handoff" },
      },
    });
    const pullRequest = advanceHandoffOutcome({
      session: { ...initial, handoffOutcome: pushed },
      jobId: "job-123",
      event: {
        action: "pr_create",
        ok: true,
        recordedAt: 30,
        auditId: "audit-pr",
        pullRequest: { url: "https://example.test/pr/42", number: 42 },
      },
    });

    assert.equal(pullRequest.version, 1);
    assert.equal(pullRequest.sessionId, initial.id);
    assert.equal(pullRequest.jobId, "job-123");
    assert.equal(pullRequest.worktreePath, "C:\\repo-spok");
    assert.equal(pullRequest.mainCheckout, "C:\\repo");
    assert.equal(pullRequest.state, "pull_request");
    assert.equal(pullRequest.commit?.oid, "abc123def456");
    assert.equal(pullRequest.push?.auditId, "audit-push");
    assert.equal(pullRequest.pullRequest?.number, 42);
    assert.deepEqual(JSON.parse(JSON.stringify(pullRequest)), pullRequest);
  });

  it("retains prior evidence and redacts an audit-safe failure", () => {
    const initial = session();
    const committed = advanceHandoffOutcome({
      session: initial,
      event: {
        action: "commit",
        ok: true,
        recordedAt: 10,
        commit: { oid: "abc123def456" },
      },
    });
    const failed = advanceHandoffOutcome({
      session: { ...initial, handoffOutcome: committed },
      event: {
        action: "push",
        ok: false,
        recordedAt: 20,
        auditId: "audit-failure",
        error: "remote rejected Bearer super-secret-token-value",
      },
    });

    assert.equal(failed.state, "failed");
    assert.equal(failed.commit?.oid, "abc123def456");
    assert.equal(failed.failure?.auditId, "audit-failure");
    assert.doesNotMatch(failed.failure?.message ?? "", /super-secret/);
    assert.match(failed.failure?.message ?? "", /REDACTED/);
  });
});
