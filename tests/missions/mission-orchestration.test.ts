import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  compileMissionReceiptBundle,
  migrateMissionReceiptBundle,
  MissionReceiptError,
  readMissionReceiptBundle,
  saveMissionReceiptBundle,
  scheduleMissionReceipts,
  type Mission,
  type MissionReceiptBundle,
  type MissionReceiptDraft,
} from "../../src/lib/missions";

let root = "";
let repository = "";
let worktreeA = "";
let worktreeB = "";
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-orchestration-"));
  process.env.SPOK_HOME = path.join(root, "home");
  repository = path.join(root, "repo");
  worktreeA = path.join(root, "worktree-a");
  worktreeB = path.join(root, "worktree-b");
  for (const dir of [repository, worktreeA, worktreeB]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

function mission(): Mission {
  return {
    version: 1,
    id: "mission-orch",
    outcome: "Compile bounded work and schedule the smallest ready team",
    definitionOfDone: ["Receipts persist", "Reserves remain protected"],
    constraints: ["Leaves remain leaves"],
    policyRef: "policy.manual.v1",
    repository,
    status: "active",
    statusProvenance: { at: 1, source: "spok", reason: "Plan accepted" },
    nextAction: { kind: "schedule", label: "Schedule ready work" },
    milestones: [],
    workItems: [
      {
        id: "wi-a",
        title: "Implement adapter",
        owner: "agent-a",
        dependencies: [],
        requestedCapability: "edit_src",
        authorityReceipt: {
          version: 1,
          policyRef: "policy.manual.v1",
          capabilities: ["read_repo", "edit_src", "run_tests"],
          repository,
          worktreePath: worktreeA,
          grantedAt: 1,
          authorityNeutralRestore: true,
        },
        budgets: { tokens: 5_000, retries: 1 },
        expectedEvidence: ["test:adapter"],
        retries: { max: 1, used: 0 },
        status: "ready",
        statusProvenance: { at: 1, source: "spok", reason: "Ready" },
      },
      {
        id: "wi-b",
        title: "Implement parser",
        owner: "agent-b",
        dependencies: [],
        requestedCapability: "edit_src",
        authorityReceipt: {
          version: 1,
          policyRef: "policy.manual.v1",
          capabilities: ["read_repo", "edit_src", "run_tests"],
          repository,
          worktreePath: worktreeB,
          grantedAt: 1,
          authorityNeutralRestore: true,
        },
        budgets: { tokens: 2_000, retries: 1 },
        expectedEvidence: ["test:parser"],
        retries: { max: 1, used: 0 },
        status: "ready",
        statusProvenance: { at: 1, source: "spok", reason: "Ready" },
      },
    ],
    dependencies: [],
    budgets: { tokens: 10_000, retries: 2 },
    authority: {
      version: 1,
      policyRef: "policy.manual.v1",
      capabilities: ["read_repo", "edit_src", "run_tests"],
      repository,
      grantedAt: 1,
      authorityNeutralRestore: true,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function draft(): MissionReceiptDraft {
  return {
    id: "receipt-001",
    repositoryBase: "abc123",
    integrationOwner: "spok",
    validation: ["npm test"],
    nextCheckpoint: "After both reports are verified",
    budget: {
      totalTokens: 10_000,
      integrationReserveTokens: 2_000,
      recoveryReserveTokens: 1_000,
    },
    workItems: [
      {
        workItemId: "wi-a",
        integrationOwner: "spok",
        priority: 10,
        scope: { own: ["src/lib/adapter"], exclude: ["src/lib/parser"] },
        execution: {
          cwd: worktreeA,
          baseRevision: "abc123",
          isolation: "verified",
          session: { intent: "new", sessionId: "11111111-1111-4111-8111-111111111111" },
          allowSubagents: false,
        },
        authority: {
          permission: "default",
          tools: ["read_repo", "edit_src", "run_tests"],
          destructive: false,
        },
        budget: { maxTurns: 8, tokens: 5_000, retry: 1 },
        context: ["src/lib/adapter.ts", "decision:provider-boundary"],
        definitionOfDone: ["Adapter tests pass"],
        checks: ["npm test -- adapter"],
        returnWhen: "complete",
      },
      {
        workItemId: "wi-b",
        integrationOwner: "spok",
        priority: 5,
        scope: { own: ["src/lib/parser"], exclude: ["src/lib/adapter"] },
        execution: {
          cwd: worktreeB,
          baseRevision: "abc123",
          isolation: "verified",
          session: { intent: "new", sessionId: "22222222-2222-4222-8222-222222222222" },
          allowSubagents: false,
        },
        authority: {
          permission: "default",
          tools: ["read_repo", "edit_src", "run_tests"],
          destructive: false,
        },
        budget: { maxTurns: 6, tokens: 2_000, retry: 1 },
        context: ["src/lib/parser.ts"],
        definitionOfDone: ["Parser fixtures pass"],
        checks: ["npm test -- parser"],
        returnWhen: "complete",
      },
    ],
  };
}

describe("mission receipt compiler", { concurrency: false }, () => {
  it("compiles, freezes, persists, reads, and migrates bounded receipts", () => {
    const bundle = compileMissionReceiptBundle(mission(), draft(), 100);
    assert.equal(bundle.mission.budget.executionTokens, 7_000);
    assert.equal(bundle.workItems[0].execution.allowSubagents, false);
    assert.equal(bundle.workItems[0].reportSchema, "specialist-v1");
    assert.ok(Object.isFrozen(bundle));
    saveMissionReceiptBundle(bundle);
    assert.deepEqual(readMissionReceiptBundle("mission-orch", "receipt-001"), bundle);

    const migrated = migrateMissionReceiptBundle({
      version: 0,
      mission_receipt: bundle.mission,
      work_item_receipts: bundle.workItems,
    });
    assert.deepEqual(migrated, bundle);
  });

  it("rejects a weak synthesis reserve, unverified cwd, and overlapping ownership", () => {
    const weak = draft();
    weak.budget.integrationReserveTokens = 1_999;
    assertReceiptError(() => compileMissionReceiptBundle(mission(), weak), "at least 20%");

    const wrongCwd = draft();
    wrongCwd.workItems[0].execution.cwd = repository;
    assertReceiptError(() => compileMissionReceiptBundle(mission(), wrongCwd), "worktree");

    const overlap = draft();
    overlap.workItems[1].scope.own = ["src/lib/adapter/internal"];
    assertReceiptError(() => compileMissionReceiptBundle(mission(), overlap), "overlapping");

    const staleBase = draft();
    staleBase.workItems[0].execution.baseRevision = "different-base";
    assertReceiptError(() => compileMissionReceiptBundle(mission(), staleBase), "base revision");
  });

  it("rejects tampered persisted budgets before scheduling", () => {
    const tampered = structuredClone(compileMissionReceiptBundle(mission(), draft()));
    tampered.mission.budget.executionTokens += 1;
    assertReceiptError(() => migrateMissionReceiptBundle(tampered), "reserves are invalid");
  });
});

describe("mission readiness scheduler", { concurrency: false }, () => {
  it("counts only provider-emitted lanes and selects isolated work within reserve", () => {
    const bundle = compileMissionReceiptBundle(mission(), draft());
    const schedule = scheduleMissionReceipts(bundle, {
      providerCapacity: 2,
      activeLanes: [
        { workItemId: "requested-placeholder", providerEmitted: false, reservedTokens: 0 },
      ],
      verifiedIsolation: { "wi-a": true, "wi-b": true },
    });
    assert.equal(schedule.capacity.requestedLanes, 1);
    assert.equal(schedule.capacity.realActiveLanes, 0);
    assert.deepEqual(schedule.selected, ["wi-a", "wi-b"]);
    assert.equal(schedule.budget.integrationReserveTokens, 2_000);
    assert.equal(schedule.budget.recoveryReserveTokens, 1_000);
  });

  it("skips an unaffordable head item so smaller ready work is not starved", () => {
    const bundle = compileMissionReceiptBundle(mission(), draft());
    const schedule = scheduleMissionReceipts(bundle, {
      providerCapacity: 2,
      consumedExecutionTokens: 3_000,
      verifiedIsolation: { "wi-a": true, "wi-b": true },
    });
    assert.deepEqual(schedule.selected, ["wi-b"]);
    assert.equal(
      schedule.decisions.find((entry) => entry.workItemId === "wi-a")?.reason,
      "budget_reserve"
    );
  });

  it("blocks missing isolation and holds dependencies, approvals, and repository locks", () => {
    const source = mission();
    source.workItems[1].dependencies = ["wi-a"];
    const dependentDraft = draft();
    const bundle = compileMissionReceiptBundle(source, dependentDraft);
    const dependency = scheduleMissionReceipts(bundle, {
      providerCapacity: 2,
      verifiedIsolation: { "wi-a": false, "wi-b": true },
      approvals: { "wi-b": "pending" },
    });
    assert.equal(dependency.decisions[0].reason, "isolation");
    assert.equal(dependency.decisions[1].reason, "dependency");

    const lockBundle = structuredClone(bundle) as MissionReceiptBundle;
    lockBundle.workItems[1].dependsOn = [];
    lockBundle.workItems[1].scope.own = ["src/lib/adapter/internal"];
    const locked = scheduleMissionReceipts(lockBundle, {
      providerCapacity: 2,
      activeLanes: [{ workItemId: "wi-a", providerEmitted: true, reservedTokens: 1_000 }],
      verifiedIsolation: { "wi-b": true },
    });
    assert.equal(
      locked.decisions.find((entry) => entry.workItemId === "wi-b")?.reason,
      "repository_lock"
    );
  });

  it("rejects unknown, duplicate, or over-budget provider lane evidence", () => {
    const bundle = compileMissionReceiptBundle(mission(), draft());
    assert.throws(
      () =>
        scheduleMissionReceipts(bundle, {
          providerCapacity: 2,
          activeLanes: [
            { workItemId: "unknown", providerEmitted: true, reservedTokens: 1 },
          ],
        }),
      /unknown work item/i
    );
    assert.throws(
      () =>
        scheduleMissionReceipts(bundle, {
          providerCapacity: 2,
          activeLanes: [
            { workItemId: "wi-a", providerEmitted: true, reservedTokens: 1 },
            { workItemId: "wi-a", providerEmitted: true, reservedTokens: 1 },
          ],
        }),
      /duplicated/i
    );
    assert.throws(
      () =>
        scheduleMissionReceipts(bundle, {
          providerCapacity: 2,
          activeLanes: [
            { workItemId: "wi-b", providerEmitted: true, reservedTokens: 2_001 },
          ],
        }),
      /exceeds the receipt budget/i
    );
  });
});

function assertReceiptError(fn: () => unknown, pattern: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof MissionReceiptError);
    assert.match(error.message, new RegExp(pattern, "i"));
    return true;
  });
}
