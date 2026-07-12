import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloneJobBlueprint,
  getJobActionAvailability,
} from "../../src/lib/automation/job-actions";
import type { AutomationJob } from "../../src/lib/automation/types";

function job(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: "job-1",
    kind: "scheduled",
    title: "Update dependencies",
    prompt: "Update safe dependencies and validate",
    cwd: "C:\\repo",
    isolate: true,
    worktreePath: "C:\\repo-spok-job-1",
    branch: "spok/job-1",
    mainCheckout: "C:\\repo",
    status: "completed",
    priority: 2,
    createdAt: 10,
    startedAt: 20,
    finishedAt: 30,
    sessionId: "session-1",
    parentSessionId: "parent-1",
    scheduleId: "schedule-1",
    channelId: "channel-1",
    agentId: "agent-1",
    exitCode: 0,
    summary: "Completed",
    ...overrides,
  };
}

describe("inbox job action availability", () => {
  it("offers cancel and priority only while queued", () => {
    assert.deepEqual(getJobActionAvailability("queued"), {
      cancel: true,
      retry: false,
      duplicate: false,
      priority_up: true,
      priority_down: true,
    });
  });

  it("offers stop for active work and retry/duplicate for recovery", () => {
    assert.equal(getJobActionAvailability("starting").cancel, true);
    assert.equal(getJobActionAvailability("running").cancel, true);
    assert.equal(getJobActionAvailability("waiting_approval").cancel, true);

    for (const status of ["failed", "cancelled", "skipped"] as const) {
      const actions = getJobActionAvailability(status);
      assert.equal(actions.cancel, false);
      assert.equal(actions.retry, true);
      assert.equal(actions.duplicate, true);
    }
    assert.equal(getJobActionAvailability("completed").retry, false);
    assert.equal(getJobActionAvailability("completed").duplicate, true);
  });
});

describe("cloneJobBlueprint", () => {
  it("preserves safe intent fields and strips all execution linkage", () => {
    const result = cloneJobBlueprint(job(), "retry");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(result.blueprint, {
      title: "Retry · Update dependencies",
      prompt: "Update safe dependencies and validate",
      cwd: "C:\\repo",
      isolate: true,
      kind: "scheduled",
      priority: 2,
      parentSessionId: "parent-1",
      agentId: "agent-1",
    });
    for (const forbidden of [
      "id",
      "status",
      "sessionId",
      "scheduleId",
      "channelId",
      "worktreePath",
      "branch",
      "mainCheckout",
      "startedAt",
      "finishedAt",
      "exitCode",
      "error",
      "summary",
    ]) {
      assert.equal(forbidden in result.blueprint, false, forbidden);
    }
  });

  it("uses the main checkout instead of the prior worktree", () => {
    const result = cloneJobBlueprint(
      job({ cwd: "C:\\repo-spok-job-1" }),
      "duplicate"
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.blueprint.cwd, "C:\\repo");
    assert.equal(result.blueprint.title, "Copy · Update dependencies");
  });

  it("refuses to clone when only the live worktree path is known", () => {
    const result = cloneJobBlueprint(
      job({
        cwd: "C:\\repo-spok-job-1\\",
        mainCheckout: undefined,
        worktreePath: "c:/repo-spok-job-1",
      }),
      "retry"
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /worktree cannot be reused/i);
  });

  it("keeps Enterprise identity on retry but strips it from a duplicate", () => {
    const enterprise = {
      version: 1 as const,
      teamId: "ent-test",
      role: "leader" as const,
      phase: "mission" as const,
      turn: 1,
      memberId: "spok",
      memberName: "Spok",
    };
    const retry = cloneJobBlueprint(job({ enterprise }), "retry");
    const duplicate = cloneJobBlueprint(job({ enterprise }), "duplicate");

    assert.equal(retry.ok, true);
    if (retry.ok) assert.deepEqual(retry.blueprint.enterprise, enterprise);
    assert.equal(duplicate.ok, true);
    if (duplicate.ok) assert.equal(duplicate.blueprint.enterprise, undefined);
  });
});
