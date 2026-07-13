/**
 * Missions UI client + leadership projection (UX-013 wire slice).
 * Success: mission with milestones/work items/checkpoint projects durable evidence.
 * Failure/recovery: API failure and empty list stay actionable — no decorative progress.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchMission,
  fetchMissionCheckpoint,
  fetchMissionList,
  missionEmptyStoreMessage,
  missionLoadRecoveryMessage,
  missionStatusLabel,
  projectMissionLeadershipView,
  workItemStatusLabel,
  type MissionClientDeps,
} from "../../src/lib/missions/client";
import type {
  Mission,
  MissionCheckpoint,
  MissionMeta,
} from "../../src/lib/missions/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function depsWithFetch(
  handler: (input: string | URL, init?: RequestInit) => Promise<Response> | Response
): MissionClientDeps {
  return {
    fetchImpl: async (input, init) => handler(input, init),
    timeoutMs: 2_000,
  };
}

function sampleMission(over: Partial<Mission> = {}): Mission {
  const now = 1_700_000_000_000;
  return {
    version: 1,
    id: "msn_ui_1",
    outcome: "Wire Missions UI to durable Mission v1 evidence",
    definitionOfDone: [
      "Milestones visible before team map",
      "Checkpoint risks and next action shown",
    ],
    constraints: ["Do not claim UX-013 closed"],
    policyRef: "policy.manual.v1",
    repository: "C:\\dev\\spok",
    status: "active",
    statusProvenance: {
      at: now,
      source: "spok",
      reason: "Leadership evidence in progress",
    },
    nextAction: {
      kind: "advance_work_item",
      label: "Complete UI client adapter tests",
      workItemId: "wi_tests",
    },
    checkpointRef: "ckpt_msn_ui_1",
    milestones: [
      {
        id: "ms_plan",
        title: "Plan and evidence surface",
        exitCriteria: ["Durable panel above decoration"],
        status: "active",
        statusProvenance: {
          at: now,
          source: "spok",
          reason: "In progress",
        },
        dependencyRefs: [],
        workItemIds: ["wi_client", "wi_tests"],
      },
    ],
    workItems: [
      {
        id: "wi_client",
        milestoneId: "ms_plan",
        title: "Client adapter",
        owner: "spok",
        dependencies: [],
        requestedCapability: "edit_src",
        budgets: { tokens: 5_000 },
        expectedEvidence: ["src/lib/missions/client.ts"],
        retries: { max: 1, used: 0 },
        status: "completed",
        statusProvenance: {
          at: now,
          source: "spok",
          reason: "Adapter landed",
        },
        terminalOutcome: {
          kind: "terminal_outcome",
          outcome: "completed",
          at: now,
          reason: "File exists with fetch + projection",
          evidenceRefs: ["src/lib/missions/client.ts"],
        },
      },
      {
        id: "wi_tests",
        milestoneId: "ms_plan",
        title: "Focused UI tests",
        owner: "Patch",
        dependencies: ["wi_client"],
        requestedCapability: "edit_tests",
        budgets: { tokens: 3_000 },
        expectedEvidence: ["tests/missions/missions-ui-client.test.ts"],
        retries: { max: 1, used: 0 },
        status: "ready",
        statusProvenance: {
          at: now,
          source: "spok",
          reason: "Waiting on test write",
        },
      },
      {
        id: "wi_process_only",
        title: "Orphan process signal",
        owner: "Nova",
        dependencies: [],
        requestedCapability: "edit_src",
        budgets: {},
        expectedEvidence: [],
        retries: { max: 0, used: 0 },
        status: "active",
        statusProvenance: {
          at: now,
          source: "system",
          reason: "Process exited without terminal claim",
        },
        processExit: {
          kind: "process_exit",
          exitCode: 0,
          at: now,
          sessionId: "sess_x",
        },
      },
    ],
    dependencies: [
      {
        id: "dep_client_tests",
        from: "wi_client",
        to: "wi_tests",
        requiresEvidence: true,
        evidenceRefs: ["src/lib/missions/client.ts"],
        satisfied: true,
      },
    ],
    budgets: { tokens: 20_000, retries: 2 },
    createdAt: now - 10_000,
    updatedAt: now,
    ...over,
  };
}

function sampleCheckpoint(missionId = "msn_ui_1"): MissionCheckpoint {
  return {
    version: 1,
    id: "ckpt_msn_ui_1",
    missionId,
    at: 1_700_000_000_500,
    completed: ["wi_client"],
    active: ["ms_plan", "wi_tests", "wi_process_only"],
    blocked: [],
    changedAssumptions: [],
    evidenceRefs: ["src/lib/missions/client.ts"],
    risks: ["Work item wi_process_only has process exit (0) without terminal outcome"],
    nextDecisions: ["Complete UI client adapter tests"],
  };
}

function sampleMeta(over: Partial<MissionMeta> = {}): MissionMeta {
  return {
    version: 1,
    id: "msn_ui_1",
    outcome: "Wire Missions UI to durable Mission v1 evidence",
    status: "active",
    statusReason: "Leadership evidence in progress",
    nextAction: {
      kind: "advance_work_item",
      label: "Complete UI client adapter tests",
      workItemId: "wi_tests",
    },
    repository: "C:\\dev\\spok",
    checkpointRef: "ckpt_msn_ui_1",
    createdAt: 1,
    updatedAt: 2,
    milestoneCount: 1,
    workItemCount: 3,
    ...over,
  };
}

describe("missions UI client adapter", () => {
  it("lists durable missions via privileged GET /api/missions", async () => {
    const meta = sampleMeta();
    const result = await fetchMissionList(
      depsWithFetch((input) => {
        assert.equal(String(input), "/api/missions");
        return jsonResponse({
          version: 1,
          missions: [meta],
          authorityNeutral: true,
        });
      })
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.authorityNeutral, true);
    assert.equal(result.value.missions.length, 1);
    assert.equal(result.value.missions[0]?.id, "msn_ui_1");
  });

  it("loads mission detail and checkpoint payloads", async () => {
    const mission = sampleMission();
    const checkpoint = sampleCheckpoint();
    const detail = await fetchMission(
      mission.id,
      depsWithFetch((input) => {
        assert.equal(String(input), `/api/missions/${mission.id}`);
        return jsonResponse({
          version: 1,
          mission,
          authorityNeutral: true,
        });
      })
    );
    assert.equal(detail.ok, true);
    if (!detail.ok) return;
    assert.equal(detail.value.mission.outcome, mission.outcome);

    const ckpt = await fetchMissionCheckpoint(
      mission.id,
      depsWithFetch((input) => {
        assert.equal(String(input), `/api/missions/${mission.id}/checkpoint`);
        return jsonResponse({
          version: 1,
          missionId: mission.id,
          checkpoint,
          authorityNeutral: true,
        });
      })
    );
    assert.equal(ckpt.ok, true);
    if (!ckpt.ok) return;
    assert.equal(ckpt.value.checkpoint.risks.length, 1);
    assert.equal(ckpt.value.persisted, undefined);
  });

  it("surfaces HTTP failure as actionable client error (not fake progress)", async () => {
    const result = await fetchMissionList(
      depsWithFetch(() =>
        jsonResponse(
          { error: "Missing local capability token", code: "missing_token" },
          401
        )
      )
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "http");
    assert.match(result.error.message, /capability|token|401|Failed/i);
    const recovery = missionLoadRecoveryMessage(result.error);
    assert.equal(recovery.primaryAction, "retry");
    assert.ok(recovery.title.length > 0);
    assert.ok(recovery.body.length > 0);
  });

  it("surfaces timeout as retryable failure", async () => {
    const result = await fetchMissionList({
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Abort via short client timeout
        return jsonResponse({ missions: [] });
      },
      timeoutMs: 1,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "timeout");
    const recovery = missionLoadRecoveryMessage(result.error);
    assert.equal(recovery.primaryAction, "retry");
    assert.match(recovery.title, /timed out/i);
  });

  it("surfaces empty list message without inventing decorative progress", () => {
    const empty = missionEmptyStoreMessage();
    assert.match(empty.title, /no durable missions/i);
    assert.match(empty.body, /never substitute|decorative/i);
    assert.doesNotMatch(empty.body, /running|progress 100|ship underway/i);
  });

  it("rejects malformed list bodies", async () => {
    const result = await fetchMissionList(
      depsWithFetch(() => jsonResponse({ version: 1, authorityNeutral: true }))
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "invalid_response");
  });
});

describe("missions UI leadership projection", () => {
  it("projects durable evidence: outcome, milestones, deps, checkpoint, next action", () => {
    const mission = sampleMission();
    const checkpoint = sampleCheckpoint();
    const view = projectMissionLeadershipView(mission, checkpoint, {
      checkpointPersisted: true,
    });

    assert.equal(view.id, "msn_ui_1");
    assert.equal(
      view.outcome,
      "Wire Missions UI to durable Mission v1 evidence"
    );
    assert.equal(view.statusLabel, missionStatusLabel("active"));
    assert.equal(view.nextAction.label, "Complete UI client adapter tests");
    assert.equal(view.authorityNeutral, true);
    assert.equal(view.isEmptyPlan, false);

    assert.equal(view.milestones.length, 1);
    const ms = view.milestones[0]!;
    assert.equal(ms.title, "Plan and evidence surface");
    assert.ok(ms.workItems.length >= 2);

    const client = ms.workItems.find((w) => w.id === "wi_client");
    assert.ok(client);
    assert.equal(client!.status, "completed");
    assert.equal(client!.ownerIsSpok, true);
    assert.equal(client!.hasTerminalEvidence, true);
    assert.equal(client!.dependencyState, "none");

    const tests = ms.workItems.find((w) => w.id === "wi_tests");
    assert.ok(tests);
    assert.equal(tests!.ownerIsSpok, false);
    assert.equal(tests!.owner, "Patch");
    assert.equal(tests!.dependencyState, "satisfied");
    assert.equal(workItemStatusLabel(tests!.status), "Ready");

    assert.ok(view.checkpoint);
    assert.equal(view.checkpoint!.persisted, true);
    assert.ok(view.checkpoint!.risks.some((r) => /process exit/i.test(r)));
    assert.ok(
      view.checkpoint!.nextDecisions.some((d) => /adapter tests/i.test(d))
    );
    assert.deepEqual(view.checkpoint!.completed, ["wi_client"]);
  });

  it("refuses process-exit-only and specialist plan owners as execution evidence", () => {
    const view = projectMissionLeadershipView(sampleMission(), sampleCheckpoint());

    const processOnly = view.workItemsWithoutMilestone.find(
      (w) => w.id === "wi_process_only"
    );
    // Orphan may sit under unassigned if not in milestone workItemIds
    const fromMs = view.milestones
      .flatMap((m) => m.workItems)
      .find((w) => w.id === "wi_process_only");
    const orphan = processOnly ?? fromMs;
    assert.ok(orphan, "process-only work item should appear in projection");
    assert.equal(orphan!.processExitOnly, true);
    assert.equal(orphan!.hasTerminalEvidence, false);
    assert.equal(orphan!.ownerIsSpok, false);

    assert.ok(view.specialistPlanOwners.length >= 1);
    for (const s of view.specialistPlanOwners) {
      assert.match(s.note, /not a running agent/i);
      assert.notEqual(s.owner.toLowerCase(), "spok");
    }
  });

  it("marks empty plans without inventing milestones or progress", () => {
    const bare = sampleMission({
      milestones: [],
      workItems: [],
      dependencies: [],
      checkpointRef: undefined,
    });
    const view = projectMissionLeadershipView(bare, null);
    assert.equal(view.isEmptyPlan, true);
    assert.equal(view.milestones.length, 0);
    assert.equal(view.workItemsWithoutMilestone.length, 0);
    assert.equal(view.checkpoint, null);
    assert.equal(view.specialistPlanOwners.length, 0);
  });

  it("shows unsatisfied dependency waiting state for blocked work", () => {
    const mission = sampleMission({
      workItems: [
        {
          id: "wi_a",
          title: "Upstream",
          owner: "spok",
          dependencies: [],
          requestedCapability: "edit_src",
          budgets: {},
          expectedEvidence: ["a"],
          retries: { max: 0, used: 0 },
          status: "pending",
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Not started",
          },
        },
        {
          id: "wi_b",
          title: "Downstream",
          owner: "spok",
          dependencies: ["wi_a"],
          requestedCapability: "edit_src",
          budgets: {},
          expectedEvidence: ["b"],
          retries: { max: 0, used: 0 },
          status: "blocked",
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Waiting on wi_a evidence",
          },
        },
      ],
      milestones: [],
      dependencies: [
        {
          id: "dep_ab",
          from: "wi_a",
          to: "wi_b",
          requiresEvidence: true,
          evidenceRefs: [],
          satisfied: false,
        },
      ],
    });
    const view = projectMissionLeadershipView(mission, null);
    const b = view.workItemsWithoutMilestone.find((w) => w.id === "wi_b");
    assert.ok(b);
    assert.equal(b!.dependencyState, "blocked");
    assert.deepEqual(b!.unsatisfiedDeps, ["wi_a"]);
  });
});
