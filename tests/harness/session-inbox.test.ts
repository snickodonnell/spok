import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSessionInbox,
  classifySessionLane,
  INBOX_LANE_ORDER,
  toInboxEntry,
} from "../../src/lib/session-inbox";
import type { AutomationJob } from "../../src/lib/automation/types";
import type { FileDiff, Session } from "../../src/lib/types";

function baseSession(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    name: "auth refactor",
    status: "ready",
    createdAt: 1,
    updatedAt: 100,
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

function job(partial: Partial<AutomationJob> & Pick<AutomationJob, "id">): AutomationJob {
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

describe("classifySessionLane", () => {
  it("maps running and starting", () => {
    assert.equal(
      classifySessionLane(baseSession({ status: "running" })).lane,
      "running"
    );
    assert.equal(
      classifySessionLane(baseSession({ status: "starting" })).lane,
      "running"
    );
  });

  it("maps errors to failed", () => {
    const r = classifySessionLane(
      baseSession({ status: "error", error: "spawn failed" })
    );
    assert.equal(r.lane, "failed");
    assert.match(r.reason, /spawn failed/);
  });

  it("prioritizes approval wait over running files", () => {
    const r = classifySessionLane(
      baseSession({
        status: "running",
        metrics: {
          ...baseSession().metrics,
          filesChanged: 3,
        },
      }),
      job({ id: "j1", sessionId: "s1", status: "waiting_approval" })
    );
    assert.equal(r.lane, "waiting");
    assert.match(r.reason, /approval/i);
  });

  it("maps conflicts to waiting", () => {
    const r = classifySessionLane(
      baseSession({
        status: "ready",
        gitSummary: {
          branch: "main",
          upstream: null,
          ahead: 0,
          behind: 0,
          stagedCount: 0,
          unstagedCount: 1,
          untrackedCount: 0,
          conflictCount: 2,
          clean: false,
          isWorktree: false,
          mainWorktreePath: null,
          repoRoot: "/repo",
          headOid: null,
          updatedAt: 1,
        },
      })
    );
    assert.equal(r.lane, "waiting");
    assert.match(r.reason, /conflict/i);
  });

  it("maps dirty / changed files to ready_review", () => {
    const r = classifySessionLane(
      baseSession({
        status: "completed",
        metrics: { ...baseSession().metrics, filesChanged: 4 },
        files: {
          a: file({ id: "a", path: "src/a.ts" }),
        },
      })
    );
    assert.equal(r.lane, "ready_review");
    assert.match(r.reason, /4 files/);
  });

  it("maps clean ready session to idle", () => {
    assert.equal(
      classifySessionLane(baseSession({ status: "ready" })).lane,
      "idle"
    );
  });

  it("maps queued jobs", () => {
    const r = classifySessionLane(
      baseSession({ status: "idle" }),
      job({ id: "j1", sessionId: "s1", status: "queued" })
    );
    assert.equal(r.lane, "queued");
  });

  it("marks partial restored shells unavailable until materialized", () => {
    const r = classifySessionLane(
      baseSession({
        hydratePartial: true,
        restoreState: "restoring",
        status: "ready",
        metrics: { ...baseSession().metrics, filesChanged: 2 },
      })
    );
    assert.equal(r.lane, "waiting");
    assert.match(r.reason, /restoring saved details/i);
  });

  it("keeps a failed restored shell actionable", () => {
    const r = classifySessionLane(
      baseSession({
        hydratePartial: true,
        restoreState: "unavailable",
        restoreError: "Snapshot could not be decoded",
      })
    );
    assert.equal(r.lane, "waiting");
    assert.match(r.reason, /snapshot could not be decoded/i);
  });
});

describe("buildSessionInbox", () => {
  it("groups lanes in priority order and builds summary", () => {
    const sessions = [
      baseSession({ id: "idle1", name: "old", status: "ready", updatedAt: 1 }),
      baseSession({
        id: "run1",
        name: "live",
        status: "running",
        updatedAt: 50,
      }),
      baseSession({
        id: "err1",
        name: "broke",
        status: "error",
        error: "boom",
        updatedAt: 40,
      }),
      baseSession({
        id: "rev1",
        name: "review me",
        status: "completed",
        updatedAt: 60,
        metrics: { ...baseSession().metrics, filesChanged: 3 },
      }),
    ];
    const inbox = buildSessionInbox(sessions);
    assert.equal(inbox.summary.total, 4);
    assert.equal(inbox.summary.byLane.running, 1);
    assert.equal(inbox.summary.byLane.failed, 1);
    assert.equal(inbox.summary.byLane.ready_review, 1);
    assert.equal(inbox.summary.byLane.idle, 1);
    assert.equal(inbox.summary.attentionCount, 1);
    assert.equal(inbox.summary.activeCount, 1);
    assert.equal(inbox.summary.readyReviewCount, 1);
    assert.match(inbox.summary.headline, /failed/i);

    const laneOrder = inbox.groups.map((g) => g.lane);
    const expected = INBOX_LANE_ORDER.filter((l) =>
      laneOrder.includes(l)
    );
    assert.deepEqual(laneOrder, expected);
    // Failed before ready_review before idle
    assert.ok(laneOrder.indexOf("failed") < laneOrder.indexOf("ready_review"));
    assert.ok(laneOrder.indexOf("running") < laneOrder.indexOf("failed"));
  });

  it("links automation jobs for waiting lane", () => {
    const sessions = [
      baseSession({ id: "s-wait", status: "running", updatedAt: 10 }),
    ];
    const jobs = [
      job({
        id: "j1",
        sessionId: "s-wait",
        status: "waiting_approval",
      }),
    ];
    const inbox = buildSessionInbox(sessions, { jobs });
    assert.equal(inbox.entries[0].lane, "waiting");
    assert.equal(inbox.summary.attentionCount, 1);
    assert.match(inbox.summary.headline, /attention/i);
    assert.equal(inbox.entries[0].jobId, "j1");
    assert.equal(inbox.entries[0].jobActions?.cancel, true);
  });

  it("includes pre-session queued jobs as stable actionable rows", () => {
    const jobs = [
      job({
        id: "j-queued",
        title: "queued work",
        status: "queued",
        priority: 3,
      }),
    ];
    const inbox = buildSessionInbox([], { jobs });

    assert.equal(inbox.summary.total, 1);
    assert.equal(inbox.summary.byLane.queued, 1);
    assert.equal(inbox.entries[0].entryId, "job:j-queued");
    assert.equal(inbox.entries[0].sessionId, "");
    assert.equal(inbox.entries[0].jobId, "j-queued");
    assert.equal(inbox.entries[0].jobPriority, 3);
    assert.equal(inbox.entries[0].jobActions?.priority_up, true);
    assert.match(inbox.entries[0].reason, /next to start/i);
  });

  it("explains queued rows when all fleet slots are occupied", () => {
    const jobs = [
      job({ id: "j-running", status: "running" }),
      job({ id: "j-waiting", status: "queued" }),
    ];
    const inbox = buildSessionInbox([], {
      jobs,
      maxConcurrentBackground: 1,
    });
    const waiting = inbox.entries.find((entry) => entry.jobId === "j-waiting");

    assert.match(waiting?.reason ?? "", /waiting for capacity/i);
    assert.match(waiting?.reason ?? "", /1\/1 slots in use/i);
  });

  it("keeps pre-session worktree preparation visible and cancellable", () => {
    const inbox = buildSessionInbox([], {
      jobs: [job({ id: "j-starting", status: "starting" })],
    });

    assert.equal(inbox.entries[0].lane, "running");
    assert.equal(inbox.entries[0].status, "starting");
    assert.match(inbox.entries[0].reason, /preparing/i);
    assert.equal(inbox.entries[0].jobActions?.cancel, true);
  });

  it("does not duplicate a job once its linked session exists", () => {
    const sessions = [baseSession({ id: "s-linked" })];
    const jobs = [job({ id: "j-linked", sessionId: "s-linked" })];
    const inbox = buildSessionInbox(sessions, { jobs });

    assert.equal(inbox.entries.length, 1);
    assert.equal(inbox.entries[0].entryId, "session:s-linked");
    assert.equal(inbox.entries[0].jobId, "j-linked");
  });

  it("sorts newer sessions first within a lane", () => {
    const sessions = [
      baseSession({ id: "a", name: "older", status: "running", updatedAt: 10 }),
      baseSession({ id: "b", name: "newer", status: "running", updatedAt: 99 }),
    ];
    const inbox = buildSessionInbox(sessions);
    const running = inbox.groups.find((g) => g.lane === "running")!;
    assert.equal(running.entries[0].sessionId, "b");
    assert.equal(running.entries[1].sessionId, "a");
  });

  it("toInboxEntry exposes branch and worktree hints", () => {
    const e = toInboxEntry(
      baseSession({
        gitSummary: {
          branch: "feat/x",
          upstream: null,
          ahead: 1,
          behind: 0,
          stagedCount: 1,
          unstagedCount: 0,
          untrackedCount: 0,
          conflictCount: 0,
          clean: false,
          isWorktree: true,
          mainWorktreePath: "/repo",
          repoRoot: "/repo",
          headOid: "abc",
          updatedAt: 1,
        },
        config: {
          ...baseSession().config,
          worktreePath: "/repo/.spok/wt-1",
        },
      })
    );
    assert.equal(e.lane, "ready_review");
    assert.equal(e.branch, "feat/x");
    assert.equal(e.isWorktree, true);
  });
});
