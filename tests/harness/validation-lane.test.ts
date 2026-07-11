import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildValidationLane,
  filterValidationItems,
  validationTabBadge,
} from "../../src/lib/validation-lane";
import type { Session, TraceNode } from "../../src/lib/types";

function baseSession(partial?: Partial<Session>): Session {
  return {
    id: "s1",
    name: "Test",
    status: "running",
    createdAt: 1000,
    updatedAt: 2000,
    config: {
      cwd: "/tmp/proj",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: 1000,
      endedAt: null,
      elapsedMs: 1000,
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
    eventLog: [],
    ...partial,
  };
}

function node(partial: Partial<TraceNode> & Pick<TraceNode, "id" | "type">): TraceNode {
  return {
    parentId: null,
    title: partial.title ?? partial.type,
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? 1000,
    children: [],
    links: [],
    depth: 0,
    status: "success",
    ...partial,
  };
}

describe("validation lane", () => {
  it("classifies tools, tests, and builds with linked files", () => {
    const session = baseSession({
      files: {
        f1: {
          id: "f1",
          path: "src/a.ts",
          status: "modified",
          language: "typescript",
          additions: 1,
          deletions: 0,
          hunks: [],
          relatedTraceIds: ["tc-test"],
          timestamp: 1500,
        },
      },
      nodes: {
        "tc-read": node({
          id: "tc-read",
          type: "tool_call",
          toolName: "read_file",
          title: "Tool: read_file",
          content: "src/a.ts",
          status: "success",
          timestamp: 1100,
          durationMs: 12,
          links: [{ kind: "file", targetId: "f1", path: "src/a.ts" }],
        }),
        "tc-test": node({
          id: "tc-test",
          type: "tool_call",
          toolName: "run_terminal_command",
          title: "Tool: npm test",
          content: "npm test",
          status: "error",
          timestamp: 1200,
          durationMs: 4000,
          links: [{ kind: "file", targetId: "f1", path: "src/a.ts" }],
        }),
        "tc-build": node({
          id: "tc-build",
          type: "tool_call",
          toolName: "run_terminal_command",
          title: "Tool: npm run build",
          content: "npm run build",
          status: "running",
          timestamp: 1300,
        }),
      },
    });

    const lane = buildValidationLane(session);
    assert.equal(lane.items.length, 3);
    assert.equal(lane.items[0].kind, "tool");
    assert.equal(lane.items[1].kind, "test");
    assert.equal(lane.items[1].status, "failed");
    assert.equal(lane.items[1].fileIds[0], "f1");
    assert.equal(lane.items[1].paths[0], "src/a.ts");
    assert.equal(lane.items[2].kind, "build");
    assert.equal(lane.items[2].status, "running");
    assert.equal(lane.summary.failed, 1);
    assert.equal(lane.summary.running, 1);
    assert.ok(lane.summary.needsAttention);
    assert.ok(validationTabBadge(lane.summary) >= 2);
  });

  it("surfaces approvals and policy denials", () => {
    const session = baseSession({
      nodes: {
        appr: node({
          id: "appr",
          type: "system",
          title: "Approval required",
          content: "High-risk custom command",
          status: "pending",
          timestamp: 1000,
          meta: { auditType: "approval_request", risk: "high" },
        }),
        pol: node({
          id: "pol",
          type: "error",
          title: "Policy denial",
          content: "Shell interpreter blocked",
          status: "error",
          timestamp: 1100,
          meta: { auditType: "policy_denial", severity: "policy" },
        }),
      },
    });

    const lane = buildValidationLane(session);
    const kinds = lane.items.map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["approval", "policy"]);
    // Both approval-required and policy denial are "blocked" (need user / policy)
    assert.equal(lane.summary.blocked, 2);
    assert.equal(lane.summary.failed, 0);
    assert.ok(lane.summary.needsAttention);

    const attention = filterValidationItems(lane.items, "attention");
    assert.equal(attention.length, 2);
    const approvals = filterValidationItems(lane.items, "approvals");
    assert.equal(approvals.length, 2);
  });

  it("includes harness run lines and session outcome", () => {
    const running = baseSession({
      nodes: {
        run: node({
          id: "run",
          type: "system",
          title: "Run",
          content: "$ grok -p \"fix the bug\"",
          status: "running",
          timestamp: 1000,
        }),
      },
    });
    const runLane = buildValidationLane(running);
    assert.equal(runLane.items.some((i) => i.kind === "run"), true);
    assert.ok(runLane.items[0].command?.includes("grok"));

    const failed = baseSession({
      status: "error",
      error: "Exit code 1",
      metrics: {
        startedAt: 1000,
        endedAt: 2000,
        elapsedMs: 1000,
        toolCallCount: 0,
        thinkingSteps: 0,
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        subagentCount: 0,
        errorCount: 1,
      },
      nodes: {},
    });
    const failedLane = buildValidationLane(failed);
    assert.ok(failedLane.items.some((i) => i.status === "failed"));
  });

  it("marks retry attempts for repeated tool group keys", () => {
    const session = baseSession({
      nodes: {
        t1: node({
          id: "t1",
          type: "tool_call",
          toolName: "run_terminal_command",
          title: "npm test",
          content: "npm test",
          status: "error",
          timestamp: 1000,
        }),
        t2: node({
          id: "t2",
          type: "tool_call",
          toolName: "run_terminal_command",
          title: "npm test",
          content: "npm test",
          status: "success",
          timestamp: 2000,
        }),
      },
    });
    const lane = buildValidationLane(session);
    const tests = lane.items.filter((i) => i.kind === "test");
    assert.equal(tests.length, 2);
    assert.equal(tests[0].attempt, 1);
    assert.equal(tests[1].attempt, 2);
  });
});
