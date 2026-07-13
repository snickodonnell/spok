import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findWorkspaceRunConflict,
  isDifferentWorkspace,
  normalizeWorkspacePath,
} from "../../src/lib/session-lifecycle-client";
import type { Session } from "../../src/lib/types";

function session(
  id: string,
  cwd: string,
  status: Session["status"],
  extra: Partial<Session> = {}
): Session {
  return {
    id,
    name: `Session ${id}`,
    status,
    createdAt: 1,
    updatedAt: 2,
    config: {
      cwd,
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
    ...extra,
  };
}

describe("session lifecycle paths", () => {
  it("normalizes Windows and trailing slashes", () => {
    assert.equal(
      normalizeWorkspacePath("C:\\dev\\spok\\"),
      normalizeWorkspacePath("c:/dev/spok")
    );
    assert.equal(
      normalizeWorkspacePath("/home/me/proj/"),
      normalizeWorkspacePath("/home/me/proj")
    );
  });

  it("detects directory change", () => {
    assert.equal(
      isDifferentWorkspace("C:\\dev\\a", "C:\\dev\\b"),
      true
    );
    assert.equal(
      isDifferentWorkspace("C:\\dev\\a\\", "c:/dev/a"),
      false
    );
    assert.equal(isDifferentWorkspace(undefined, "C:\\dev\\a"), true);
    assert.equal(isDifferentWorkspace("C:\\dev\\a", ""), true);
  });

  it("only reports the exact foreground checkout as a conflict", () => {
    const sessions = {
      same: session("same", "C:\\dev\\a", "running"),
      unrelated: session("unrelated", "C:\\dev\\b", "running"),
      isolated: session("isolated", "C:\\dev\\a", "running", {
        backgroundJob: true,
        config: {
          cwd: "C:\\dev\\a",
          command: "grok",
          args: [],
          autoScroll: true,
          playbackSpeed: 1,
          worktreePath: "C:\\dev\\a-spok-worktree",
        },
      }),
    };

    assert.equal(
      findWorkspaceRunConflict("c:/dev/a/", sessions)?.sessionId,
      "same"
    );
    assert.equal(findWorkspaceRunConflict("C:\\dev\\c", sessions), null);
  });

  it("does not treat terminal or ready sessions as run conflicts", () => {
    const sessions = {
      ready: session("ready", "C:\\dev\\a", "ready"),
      complete: session("complete", "C:\\dev\\a", "completed"),
    };
    assert.equal(findWorkspaceRunConflict("C:\\dev\\a", sessions), null);
  });
});
