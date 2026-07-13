/**
 * Monitor + Run lifecycle projection — reuses session-inbox classification.
 * Covers success, contradiction/diagnostic, and recovery/next-action paths.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationJob } from "../../src/lib/automation/types";
import {
  findLinkedJob,
  INBOX_LIFECYCLE_PRESENTATION_VERSION,
  processStatusLabel,
  projectJobLifecycle,
  projectRunLifecycle,
} from "../../src/lib/session-lifecycle-projection";
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

describe("projectRunLifecycle", () => {
  it("projects a clean completed run as finished with a single next action", () => {
    const projection = projectRunLifecycle(
      baseSession({ status: "completed" })
    );

    assert.equal(
      projection.lifecycleVersion,
      INBOX_LIFECYCLE_PRESENTATION_VERSION
    );
    assert.equal(projection.lane, "finished");
    assert.equal(projection.badgeLabel, "Finished");
    assert.equal(projection.isDiagnostic, false);
    assert.equal(projection.reasonSource, "session");
    assert.equal(projection.reason, "Completed");
    assert.equal(projection.processStatus, "completed");
    assert.equal(projection.processLabel, "Process exited");
    assert.deepEqual(projection.nextAction, {
      kind: "open_session",
      label: "View result",
    });
  });

  it("projects review-ready success with review provenance and next action", () => {
    const projection = projectRunLifecycle(
      baseSession({
        status: "completed",
        metrics: { ...baseSession().metrics, filesChanged: 2 },
        files: {
          a: file({ id: "a", path: "src/a.ts" }),
        },
      })
    );

    assert.equal(projection.lane, "ready_review");
    assert.equal(projection.badgeLabel, "Ready for review");
    assert.equal(projection.tone, "review");
    assert.equal(projection.reasonSource, "review");
    assert.equal(projection.isDiagnostic, false);
    // Process exit stays a distinct layer — not collapsed into review readiness.
    assert.equal(projection.processLabel, "Process exited");
    assert.deepEqual(projection.nextAction, {
      kind: "review_changes",
      label: "Review changes",
    });
  });

  it("never claims Completed when session/job durable claims contradict", () => {
    const session = baseSession({ status: "completed" });
    const linked = job({
      id: "j-running",
      sessionId: session.id,
      status: "running",
    });
    const projection = projectRunLifecycle(session, linked);

    assert.equal(projection.isDiagnostic, true);
    assert.equal(projection.reasonSource, "diagnostic");
    assert.equal(projection.lane, "waiting");
    assert.equal(projection.badgeLabel, "Needs attention");
    assert.notEqual(projection.badgeLabel.toLowerCase(), "completed");
    assert.notEqual(projection.badgeLabel.toLowerCase(), "finished");
    assert.match(projection.reason, /state mismatch/i);
    // Process and job layers remain visible and distinct.
    assert.equal(projection.processStatus, "completed");
    assert.equal(projection.processLabel, "Process exited");
    assert.equal(projection.jobStatus, "running");
    assert.equal(projection.jobLabel, "Running");
    assert.deepEqual(projection.nextAction, {
      kind: "open_session",
      label: "Inspect state",
    });
  });

  it("surfaces outcome mismatch (process completed + job failed) as diagnostic", () => {
    const session = baseSession({ status: "completed" });
    const linked = job({
      id: "j-fail",
      sessionId: session.id,
      status: "failed",
      error: "exit 1",
    });
    const projection = projectRunLifecycle(session, linked);

    assert.equal(projection.isDiagnostic, true);
    assert.equal(projection.badgeLabel, "Needs attention");
    assert.match(projection.reason, /outcome mismatch/i);
    assert.equal(projection.nextAction.label, "Inspect state");
  });
});

describe("projectJobLifecycle", () => {
  it("projects a healthy running job-only row with job provenance", () => {
    const projection = projectJobLifecycle(
      job({ id: "j-run", status: "running", title: "nightly" })
    );

    assert.equal(projection.lane, "running");
    assert.equal(projection.badgeLabel, "Running");
    assert.equal(projection.reasonSource, "job");
    assert.equal(projection.processStatus, null);
    assert.equal(projection.jobStatus, "running");
    assert.deepEqual(projection.nextAction, {
      kind: "open_job",
      label: "View job",
    });
  });

  it("prefers session-linked classification including review readiness", () => {
    const session = baseSession({
      id: "s-linked",
      status: "completed",
      metrics: { ...baseSession().metrics, filesChanged: 3 },
    });
    const linked = job({
      id: "j-done",
      sessionId: session.id,
      status: "completed",
    });
    const projection = projectJobLifecycle(linked, session);

    assert.equal(projection.lane, "ready_review");
    assert.equal(projection.reasonSource, "review");
    assert.equal(projection.badgeLabel, "Ready for review");
    assert.deepEqual(projection.nextAction, {
      kind: "review_changes",
      label: "Review changes",
    });
  });

  it("diagnoses durable job outcome vs status contradiction", () => {
    const projection = projectJobLifecycle(
      job({
        id: "j-conflict",
        status: "completed",
        outcome: { kind: "failed", at: 10 },
      })
    );

    assert.equal(projection.isDiagnostic, true);
    assert.equal(projection.badgeLabel, "Needs attention");
    assert.equal(projection.reasonSource, "diagnostic");
    assert.match(projection.reason, /outcome mismatch/i);
    assert.equal(projection.nextAction.label, "View job");
  });
});

describe("findLinkedJob + processStatusLabel", () => {
  it("prefers active linked jobs over finished ones", () => {
    const jobs = [
      job({ id: "j-old", sessionId: "s1", status: "completed" }),
      job({ id: "j-live", sessionId: "s1", status: "running" }),
      job({ id: "j-other", sessionId: "s2", status: "queued" }),
    ];
    const linked = findLinkedJob("s1", jobs);
    assert.equal(linked?.id, "j-live");
  });

  it("keeps process labels distinct from operational lanes", () => {
    assert.equal(processStatusLabel("completed"), "Process exited");
    assert.equal(processStatusLabel("error"), "Process error");
    assert.equal(processStatusLabel(null), null);
  });
});
