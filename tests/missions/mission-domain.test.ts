import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  applyBudgetConsumption,
  assertDependencySatisfaction,
  assertRetryAllowed,
  assertWorkItemCompletion,
  buildBudgetReceipt,
  checkpointFromJSON,
  checkpointMission,
  checkpointToJSON,
  createMission,
  importMission,
  listMissions,
  materializeCheckpoint,
  readCheckpoint,
  readMission,
  sanitizeMission,
  writeMission,
  type Mission,
  type WorkItem,
} from "../../src/lib/missions";

let root = "";
let workspace = "";
let previousSpokHome: string | undefined;

function baseMission(overrides: Partial<Mission> = {}): Mission {
  const now = 1_700_000_000_000;
  return {
    version: 1,
    id: "msn_test_alpha",
    outcome: "Ship Mission v1 domain slice with durable checkpoints",
    definitionOfDone: [
      "CRUD API works",
      "Dependency completion requires evidence",
    ],
    constraints: ["No UI rewrite", "No scheduler"],
    policyRef: "policy.manual.v1",
    repository: workspace,
    status: "draft",
    statusProvenance: {
      at: now,
      source: "user",
      reason: "Mission created",
    },
    nextAction: { kind: "plan", label: "Define milestones and work items" },
    milestones: [],
    workItems: [],
    dependencies: [],
    budgets: {
      timeMs: 3_600_000,
      tokens: 100_000,
      toolCalls: 500,
      retries: 3,
    },
    authority: {
      version: 1,
      policyRef: "policy.manual.v1",
      capabilities: ["read_repo", "run_tests", "edit_src"],
      repository: workspace,
      grantedAt: now,
      authorityNeutralRestore: true,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  previousSpokHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-missions-"));
  workspace = path.join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  process.env.SPOK_HOME = path.join(root, "home");
});

afterEach(() => {
  if (previousSpokHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousSpokHome;
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe("Mission v1 domain", { concurrency: false }, () => {
  it("creates and reads a mission with milestone and work item", () => {
    const created = createMission({
      id: "msn_create_1",
      outcome: "Advance P1 mission record",
      definitionOfDone: ["Types persist", "API lists missions"],
      policyRef: "policy.manual.v1",
      repository: workspace,
      budgets: { tokens: 50_000, retries: 2 },
      authority: {
        policyRef: "policy.manual.v1",
        capabilities: ["read_repo", "run_tests"],
        repository: workspace,
      },
      milestones: [
        {
          id: "ms_1",
          title: "Domain contract",
          exitCriteria: ["Mission schema stable"],
          status: "active",
          dependencyRefs: ["wi_1"],
          workItemIds: ["wi_1"],
          statusProvenance: {
            at: Date.now(),
            source: "spok",
            reason: "In progress",
          },
        },
      ],
      workItems: [
        {
          id: "wi_1",
          milestoneId: "ms_1",
          title: "Implement types + persist",
          owner: "spok",
          requestedCapability: "edit_src",
          dependencies: [],
          expectedEvidence: ["tests/missions/mission-domain.test.ts"],
          budgets: { tokens: 20_000, retries: 1 },
          retries: { max: 1, used: 0 },
          status: "ready",
          statusProvenance: {
            at: Date.now(),
            source: "spok",
            reason: "Ready to start",
          },
        },
      ],
      dependencies: [
        {
          id: "dep_ms_wi",
          from: "wi_1",
          to: "ms_1",
          requiresEvidence: true,
          evidenceRefs: [],
          satisfied: false,
        },
      ],
    });

    // edit_src not in mission capabilities — create should deny
    assert.equal(created.ok, false);
    if (!created.ok) {
      assert.equal(created.code, "authority_over_request");
    }

    const okCreate = createMission({
      id: "msn_create_1",
      outcome: "Advance P1 mission record",
      definitionOfDone: ["Types persist", "API lists missions"],
      policyRef: "policy.manual.v1",
      repository: workspace,
      budgets: { tokens: 50_000, retries: 2 },
      authority: {
        policyRef: "policy.manual.v1",
        capabilities: ["read_repo", "run_tests", "edit_src"],
        repository: workspace,
      },
      milestones: [
        {
          id: "ms_1",
          title: "Domain contract",
          exitCriteria: ["Mission schema stable"],
          status: "active",
          dependencyRefs: ["wi_1"],
          workItemIds: ["wi_1"],
          statusProvenance: {
            at: 100,
            source: "spok",
            reason: "In progress",
          },
        },
      ],
      workItems: [
        {
          id: "wi_1",
          milestoneId: "ms_1",
          title: "Implement types + persist",
          owner: "spok",
          requestedCapability: "edit_src",
          dependencies: [],
          expectedEvidence: ["tests/missions/mission-domain.test.ts"],
          budgets: { tokens: 20_000, retries: 1 },
          retries: { max: 1, used: 0 },
          status: "ready",
          statusProvenance: {
            at: 100,
            source: "spok",
            reason: "Ready to start",
          },
        },
      ],
      dependencies: [
        {
          id: "dep_ms_wi",
          from: "wi_1",
          to: "ms_1",
          requiresEvidence: true,
          evidenceRefs: [],
          satisfied: false,
        },
      ],
    });
    assert.equal(okCreate.ok, true);
    if (!okCreate.ok) return;

    const loaded = readMission("msn_create_1");
    assert.ok(loaded);
    assert.equal(loaded?.version, 1);
    assert.equal(loaded?.milestones.length, 1);
    assert.equal(loaded?.workItems.length, 1);
    assert.equal(loaded?.workItems[0]?.owner, "spok");
    assert.equal(loaded?.dependencies[0]?.requiresEvidence, true);
    assert.equal(loaded?.authority?.authorityNeutralRestore, true);

    const listed = listMissions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "msn_create_1");
    assert.equal(listed[0]?.milestoneCount, 1);
    assert.equal(listed[0]?.workItemCount, 1);
  });

  it("refuses false dependency completion without evidence", () => {
    const denied = assertDependencySatisfaction({
      id: "dep_1",
      from: "wi_a",
      to: "wi_b",
      requiresEvidence: true,
      evidenceRefs: [],
      satisfied: true,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.code, "missing_evidence");

    const processOnly = assertDependencySatisfaction(
      {
        id: "dep_1",
        from: "wi_a",
        to: "wi_b",
        requiresEvidence: true,
        evidenceRefs: ["proc-exit-0"],
        satisfied: true,
      },
      { processExitOnly: true }
    );
    assert.equal(processOnly.ok, false);

    const ok = assertDependencySatisfaction({
      id: "dep_1",
      from: "wi_a",
      to: "wi_b",
      requiresEvidence: true,
      evidenceRefs: ["tests/missions/mission-domain.test.ts#dep"],
      satisfied: true,
    });
    assert.equal(ok.ok, true);

    const mission = baseMission({
      workItems: [
        {
          id: "wi_a",
          title: "Upstream",
          owner: "spok",
          dependencies: [],
          requestedCapability: "read_repo",
          budgets: {},
          expectedEvidence: [],
          retries: { max: 0, used: 0 },
          status: "completed",
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Done",
          },
          // missing terminalOutcome — should fail sanitize
        },
      ],
    });
    const badComplete = sanitizeMission(mission);
    assert.equal(badComplete.ok, false);
    if (!badComplete.ok) assert.equal(badComplete.code, "missing_evidence");
  });

  it("keeps terminal provenance distinct from process exit", () => {
    const wi: WorkItem = {
      id: "wi_exit",
      title: "Agent run",
      owner: "specialist",
      dependencies: [],
      requestedCapability: "run_tests",
      budgets: {},
      expectedEvidence: ["junit.xml"],
      retries: { max: 1, used: 0 },
      status: "completed",
      statusProvenance: { at: 1, source: "system", reason: "process ended" },
      processExit: {
        kind: "process_exit",
        exitCode: 0,
        at: 1,
        sessionId: "sess_abc123",
      },
      // no terminalOutcome
    };
    const noTerm = assertWorkItemCompletion(wi);
    assert.equal(noTerm.ok, false);

    const withTerm: WorkItem = {
      ...wi,
      terminalOutcome: {
        kind: "terminal_outcome",
        outcome: "completed",
        at: 2,
        reason: "Tests green and expected evidence attached",
        evidenceRefs: ["junit.xml"],
        processExit: wi.processExit,
      },
    };
    const ok = assertWorkItemCompletion(withTerm);
    assert.equal(ok.ok, true);

    // Process exit kind must not be smuggled as terminal
    const smuggled = sanitizeMission(
      baseMission({
        workItems: [
          {
            ...withTerm,
            terminalOutcome: {
              // @ts-expect-error intentional invalid kind for sanitize
              kind: "process_exit",
              outcome: "completed",
              at: 2,
              reason: "nope",
              evidenceRefs: ["x"],
            } as WorkItem["terminalOutcome"],
          },
        ],
      })
    );
    assert.equal(smuggled.ok, false);
  });

  it("records budget exhaustion and denies child over-parent budgets", () => {
    const grant = { tokens: 100, toolCalls: 10, retries: 2 };
    const exhausted = applyBudgetConsumption(grant, { tokens: 90 }, { tokens: 20 });
    assert.equal(exhausted.ok, false);
    if (!exhausted.ok) {
      assert.equal(exhausted.code, "budget_exhausted");
      assert.ok(exhausted.receipt?.exhausted.includes("tokens"));
    }

    const receipt = buildBudgetReceipt(grant, { tokens: 100, toolCalls: 10 });
    assert.ok(receipt.exhausted.includes("tokens"));
    assert.ok(receipt.exhausted.includes("tools"));

    const overParent = sanitizeMission(
      baseMission({
        budgets: { tokens: 100, retries: 1 },
        workItems: [
          {
            id: "wi_over",
            title: "Too much budget",
            owner: "spok",
            dependencies: [],
            requestedCapability: "read_repo",
            budgets: { tokens: 500 },
            expectedEvidence: [],
            retries: { max: 1, used: 0 },
            status: "pending",
            statusProvenance: {
              at: 1,
              source: "spok",
              reason: "pending",
            },
          },
        ],
      })
    );
    assert.equal(overParent.ok, false);
    if (!overParent.ok) assert.equal(overParent.code, "budget_over_parent");

    const retryDenied = assertRetryAllowed({
      id: "wi_r",
      retries: { max: 2, used: 2 },
    });
    assert.equal(retryDenied.ok, false);
    if (!retryDenied.ok) assert.equal(retryDenied.code, "retry_exhausted");
  });

  it("denies authority over-request on capabilities and policy", () => {
    const overCap = sanitizeMission(
      baseMission({
        workItems: [
          {
            id: "wi_auth",
            title: "Escalate",
            owner: "agent",
            dependencies: [],
            requestedCapability: "bypass_permissions",
            budgets: {},
            expectedEvidence: [],
            retries: { max: 0, used: 0 },
            status: "pending",
            statusProvenance: {
              at: 1,
              source: "spok",
              reason: "pending",
            },
          },
        ],
      })
    );
    assert.equal(overCap.ok, false);
    if (!overCap.ok) assert.equal(overCap.code, "authority_over_request");

    const overReceipt = sanitizeMission(
      baseMission({
        workItems: [
          {
            id: "wi_auth2",
            title: "Broaden",
            owner: "agent",
            dependencies: [],
            requestedCapability: "read_repo",
            budgets: {},
            expectedEvidence: [],
            retries: { max: 0, used: 0 },
            status: "pending",
            statusProvenance: {
              at: 1,
              source: "spok",
              reason: "pending",
            },
            authorityReceipt: {
              version: 1,
              policyRef: "policy.manual.v1",
              capabilities: ["read_repo", "shell_unrestricted"],
              repository: workspace,
              grantedAt: 1,
              authorityNeutralRestore: true,
            },
          },
        ],
      })
    );
    assert.equal(overReceipt.ok, false);
    if (!overReceipt.ok) assert.equal(overReceipt.code, "authority_over_request");
  });

  it("checkpoint round-trips without replaying a transcript", () => {
    const mission = baseMission({
      status: "active",
      milestones: [
        {
          id: "ms_1",
          title: "Slice",
          exitCriteria: ["tests pass"],
          status: "active",
          dependencyRefs: ["wi_1"],
          workItemIds: ["wi_1"],
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Active",
          },
        },
      ],
      workItems: [
        {
          id: "wi_1",
          title: "Domain",
          owner: "spok",
          milestoneId: "ms_1",
          dependencies: [],
          requestedCapability: "edit_src",
          budgets: { tokens: 10_000 },
          expectedEvidence: ["mission-domain.test.ts"],
          retries: { max: 1, used: 0 },
          status: "active",
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Working",
          },
        },
        {
          id: "wi_2",
          title: "Blocked follow-up",
          owner: "spok",
          dependencies: ["wi_1"],
          requestedCapability: "run_tests",
          budgets: {},
          expectedEvidence: ["junit.xml"],
          retries: { max: 0, used: 0 },
          status: "blocked",
          statusProvenance: {
            at: 1,
            source: "spok",
            reason: "Waiting on wi_1 evidence",
          },
        },
      ],
      dependencies: [
        {
          id: "dep_1",
          from: "wi_1",
          to: "wi_2",
          requiresEvidence: true,
          evidenceRefs: [],
          satisfied: false,
        },
      ],
    });

    const written = writeMission(mission);
    assert.equal(written.ok, true);

    // Pure projection — no events.ndjson, no session transcript
    const projected = materializeCheckpoint({
      mission,
      at: 42,
      id: "ckpt_msn_test_alpha_42",
    });
    assert.equal(projected.version, 1);
    assert.ok(projected.active.includes("wi_1"));
    assert.ok(projected.active.includes("ms_1"));
    assert.equal(projected.blocked.length, 1);
    assert.equal(projected.blocked[0]?.id, "wi_2");
    assert.match(projected.blocked[0]?.reason ?? "", /wi_1/);
    assert.ok(projected.evidenceRefs.includes("mission-domain.test.ts"));

    const json = checkpointToJSON(projected);
    // Ensure we did not embed a transcript-like blob
    assert.doesNotMatch(json, /events\.ndjson|transcript|stdout/i);
    const roundTrip = checkpointFromJSON(json);
    assert.deepEqual(roundTrip, projected);

    const persisted = checkpointMission("msn_test_alpha", {
      at: 42,
      changedAssumptions: ["Persistence is plan-only until scheduler"],
    });
    assert.equal(persisted.ok, true);
    if (!persisted.ok) return;

    const reloaded = readMission("msn_test_alpha");
    assert.equal(reloaded?.checkpointRef, persisted.value.checkpoint.id);
    const diskCkpt = readCheckpoint(
      "msn_test_alpha",
      persisted.value.checkpoint.id
    );
    assert.ok(diskCkpt);
    assert.equal(diskCkpt?.changedAssumptions[0], "Persistence is plan-only until scheduler");

    // Import/restore remains authority-neutral
    const imported = importMission(
      {
        ...mission,
        id: "msn_imported",
      },
      "fixture://missions/v1"
    );
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.value.importMeta?.authorityNeutral, true);
    assert.equal(imported.value.authority?.authorityNeutralRestore, true);
    // Import does not create trust files under SPOK_HOME
    const trustPath = path.join(process.env.SPOK_HOME!, "trusted-roots.json");
    // trust file may or may not exist from other code; ensure import didn't write grant
    if (existsSync(trustPath)) {
      const trustRaw = readFileSync(trustPath, "utf8");
      assert.doesNotMatch(trustRaw, new RegExp(workspace.replace(/\\/g, "\\\\")));
    }
  });
});
