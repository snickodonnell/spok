import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createJob,
  mergeRecoveredJobs,
  pickNextJobs,
  countRunning,
  describeJobQueueStatus,
  patchJob,
  summarizeJobResult,
  trimJobHistory,
} from "../../src/lib/automation/queue";
import {
  extractSubagentLanes,
  mergeSubagentSummaries,
  isSubagentPollutingNode,
  isSubagentEvent,
} from "../../src/lib/automation/subagent-lanes";
import {
  computeNextRunAt,
  intervalToMs,
} from "../../src/lib/automation/types";
import {
  sanitizeSchedule,
  listDueSchedules,
  saveSchedules,
  loadSchedules,
  markScheduleRun,
} from "../../src/lib/automation/schedules-fs";
import {
  sanitizeChannel,
  applyChannelTemplate,
  generateChannelSecret,
} from "../../src/lib/automation/channels-fs";
import {
  evaluateAutomationCwdPolicy,
  evaluateSchedulePolicy,
} from "../../src/lib/automation/policy";
import {
  trustWorkspaceRoot,
  clearTrustedRoots,
} from "../../src/lib/security/workspace-trust";
import {
  createNotification,
  unreadCount,
  prependNotification,
  markAllNotificationsRead,
} from "../../src/lib/automation/notifications";
import type { TraceNode } from "../../src/lib/types";

describe("background queue", () => {
  it("picks highest priority queued jobs within concurrency", () => {
    let jobs = [
      createJob({
        kind: "background",
        title: "low",
        prompt: "p",
        cwd: "/a",
        priority: 0,
      }),
      createJob({
        kind: "scheduled",
        title: "high",
        prompt: "p",
        cwd: "/a",
        priority: 5,
      }),
      createJob({
        kind: "background",
        title: "mid",
        prompt: "p",
        cwd: "/a",
        priority: 2,
      }),
    ];
    jobs = patchJob(jobs, jobs[0].id, { status: "running" });
    const next = pickNextJobs(jobs, 2);
    assert.equal(next.length, 1);
    assert.equal(next[0].title, "high");
    assert.equal(countRunning(jobs), 1);
  });

  it("explains capacity waits using runner priority order", () => {
    const running = createJob({
      kind: "background",
      title: "running",
      prompt: "p",
      cwd: "/a",
    });
    running.status = "running";
    const low = createJob({
      kind: "background",
      title: "low",
      prompt: "p",
      cwd: "/a",
      priority: 0,
    });
    const high = createJob({
      kind: "background",
      title: "high",
      prompt: "p",
      cwd: "/a",
      priority: 5,
    });
    const jobs = [low, running, high];

    const highStatus = describeJobQueueStatus(jobs, high.id, 1);
    const lowStatus = describeJobQueueStatus(jobs, low.id, 1);
    assert.equal(highStatus?.position, 1);
    assert.equal(lowStatus?.position, 2);
    assert.match(highStatus?.reason ?? "", /1\/1 slots in use/i);
    assert.match(lowStatus?.reason ?? "", /#2 of 2/i);
  });

  it("describes the next durable job when capacity is available", () => {
    const next = createJob({
      kind: "background",
      title: "next",
      prompt: "p",
      cwd: "/a",
    });
    assert.match(
      describeJobQueueStatus([next], next.id, 2)?.reason ?? "",
      /next to start/i
    );
  });

  it("summarizes job results", () => {
    assert.match(
      summarizeJobResult({
        status: "completed",
        filesChanged: 3,
        toolCalls: 2,
      }),
      /Completed/
    );
    assert.match(
      summarizeJobResult({ status: "failed", error: "boom" }),
      /boom/
    );
  });

  it("trims history but keeps active jobs", () => {
    const active = createJob({
      kind: "background",
      title: "run",
      prompt: "p",
      cwd: "/a",
    });
    active.status = "running";
    const done = Array.from({ length: 20 }, (_, i) => {
      const j = createJob({
        kind: "background",
        title: `d${i}`,
        prompt: "p",
        cwd: "/a",
      });
      j.status = "completed";
      j.finishedAt = Date.now() - i;
      return j;
    });
    const trimmed = trimJobHistory([active, ...done], 5);
    assert.ok(trimmed.some((j) => j.id === active.id));
    assert.ok(trimmed.length <= 5);
  });

  it("prefers jobs created while boot recovery was in flight", () => {
    const recovered = createJob({
      kind: "background",
      title: "stale disk copy",
      prompt: "old",
      cwd: "/a",
    });
    recovered.id = "job-race";
    const current = { ...recovered, title: "fresh in-memory copy", prompt: "new" };
    const anotherRecovered = createJob({
      kind: "background",
      title: "disk only",
      prompt: "restore",
      cwd: "/a",
    });

    const merged = mergeRecoveredJobs(
      [current],
      [recovered, anotherRecovered]
    );
    assert.equal(merged.find((job) => job.id === "job-race")?.title, "fresh in-memory copy");
    assert.ok(merged.some((job) => job.id === anotherRecovered.id));
  });
});

describe("subagent lanes", () => {
  it("extracts lanes and merges summaries without polluting main nodes list", () => {
    const nodes: Record<string, TraceNode> = {
      sa1: {
        id: "sa1",
        parentId: null,
        type: "subagent",
        title: "Explore auth",
        content: "Scanning auth module",
        summary: "Scanning auth module",
        timestamp: 1000,
        status: "running",
        children: ["t1"],
        links: [],
        depth: 0,
        subagentId: "lane-auth",
      },
      t1: {
        id: "t1",
        parentId: "sa1",
        type: "tool_call",
        title: "grep",
        content: "grep auth",
        timestamp: 1100,
        status: "success",
        children: [],
        links: [],
        depth: 1,
      },
      main: {
        id: "main",
        parentId: null,
        type: "thinking",
        title: "Thought",
        content: "Main agent thinking about the plan",
        timestamp: 900,
        status: "success",
        children: [],
        links: [],
        depth: 0,
      },
    };

    const lanes = extractSubagentLanes(nodes);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0].id, "lane-auth");
    assert.ok(lanes[0].toolCallCount >= 1);

    const merged = mergeSubagentSummaries(lanes);
    assert.match(merged, /Subagent summary/);
    assert.match(merged, /Explore auth/);

    assert.equal(isSubagentPollutingNode(nodes.sa1, lanes), true);
    assert.equal(isSubagentPollutingNode(nodes.t1, lanes), true);
    assert.equal(isSubagentPollutingNode(nodes.main, lanes), false);

    assert.equal(
      isSubagentEvent({
        type: "subagent_start",
        timestamp: 1,
      }),
      true
    );
  });
});

describe("schedules and policy", () => {
  let home: string;
  const prevHome = process.env.SPOK_HOME;

  before(() => {
    home = mkdtempSync(path.join(tmpdir(), "spok-auto-"));
    process.env.SPOK_HOME = home;
    clearTrustedRoots();
  });

  after(() => {
    // Clear while SPOK_HOME still points at the temp home so we never
    // wipe the operator's live workspace-trust.json.
    clearTrustedRoots();
    if (prevHome === undefined) delete process.env.SPOK_HOME;
    else process.env.SPOK_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("computes intervals and next run", () => {
    assert.equal(intervalToMs(2, "hours"), 2 * 3600000);
    const next = computeNextRunAt(1_000_000, 1, "minutes");
    assert.equal(next, 1_000_000 + 60_000);
  });

  it("sanitizes schedules and lists due ones", () => {
    const s = sanitizeSchedule({
      name: "Nightly",
      cwd: path.join(home, "repo"),
      prompt: "check health",
      every: 1,
      unit: "minutes",
      nextRunAt: Date.now() - 1000,
      enabled: true,
    });
    assert.ok(s);
    saveSchedules([s!]);
    const loaded = loadSchedules();
    assert.equal(loaded.length, 1);
    const due = listDueSchedules();
    assert.equal(due.length, 1);

    const marked = markScheduleRun(s!.id, {
      lastRunAt: Date.now(),
      lastStatus: "queued",
    });
    assert.ok(marked?.nextRunAt && marked.nextRunAt > Date.now());
  });

  it("blocks untrusted cwd for automation", () => {
    const denied = evaluateAutomationCwdPolicy({
      cwd: path.join(home, "untrusted"),
      requireTrusted: true,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.code, "untrusted_cwd");

    const root = trustWorkspaceRoot(path.join(home, "trusted"));
    const ok = evaluateAutomationCwdPolicy({
      cwd: root,
      requireTrusted: true,
    });
    assert.equal(ok.ok, true);

    const sched = sanitizeSchedule({
      name: "x",
      cwd: root,
      prompt: "hi",
      enabled: true,
    })!;
    assert.equal(evaluateSchedulePolicy(sched).ok, true);
  });

  it("enforces isolation guard when cwd equals main checkout", () => {
    const root = trustWorkspaceRoot(path.join(home, "iso"));
    const d = evaluateAutomationCwdPolicy({
      cwd: root,
      requireTrusted: true,
      isolate: true,
      mainCheckout: root,
    });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.code, "isolation_guard");
  });
});

describe("channels", () => {
  it("applies templates and sanitizes", () => {
    const secret = generateChannelSecret();
    assert.ok(secret.length > 8);
    const ch = sanitizeChannel({
      name: "CI",
      cwd: "/repo",
      secret,
      promptTemplate: "Event {{title}}: {{payload}}",
    });
    assert.ok(ch);
    assert.equal(
      applyChannelTemplate(ch!.promptTemplate, {
        title: "fail",
        payload: "tests red",
      }),
      "Event fail: tests red"
    );
  });
});

describe("notifications", () => {
  it("tracks unread and mark all", () => {
    let list = prependNotification(
      [],
      createNotification({
        kind: "run_complete",
        title: "Done",
        body: "ok",
      })
    );
    list = prependNotification(
      list,
      createNotification({
        kind: "run_failed",
        title: "Fail",
        body: "nope",
      })
    );
    assert.equal(unreadCount(list), 2);
    list = markAllNotificationsRead(list);
    assert.equal(unreadCount(list), 0);
  });
});
