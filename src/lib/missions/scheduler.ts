/** Deterministic dependency/capacity/isolation/lock/reserve scheduler. */

import { z } from "zod";
import type { MissionReceiptBundle, WorkItemReceipt } from "./receipts";

export const MISSION_SCHEDULER_VERSION = 1 as const;

export type ProviderLaneEvidence = {
  workItemId: string;
  providerEmitted: boolean;
  reservedTokens: number;
};

export type ApprovalState = "approved" | "pending" | "denied";

export type ScheduleReason =
  | "selected"
  | "terminal"
  | "active"
  | "provider_evidence"
  | "dependency"
  | "approval"
  | "approval_denied"
  | "isolation"
  | "repository_lock"
  | "capacity"
  | "budget_reserve";

export type WorkItemScheduleDecision = {
  workItemId: string;
  state: "selected" | "active" | "waiting" | "blocked" | "terminal";
  reason: ScheduleReason;
  detail: string;
};

export type MissionScheduleInput = {
  providerCapacity: number;
  activeLanes?: ProviderLaneEvidence[];
  approvals?: Record<string, ApprovalState>;
  verifiedIsolation?: Record<string, boolean>;
  consumedExecutionTokens?: number;
};

export const missionScheduleInputSchema = z
  .object({
    providerCapacity: z.number().int().min(0).max(64),
    activeLanes: z
      .array(
        z
          .object({
            workItemId: z.string().min(1).max(128),
            providerEmitted: z.boolean(),
            reservedTokens: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(64)
      .optional(),
    approvals: z.record(z.string(), z.enum(["approved", "pending", "denied"])).optional(),
    verifiedIsolation: z.record(z.string(), z.boolean()).optional(),
    consumedExecutionTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export function parseMissionScheduleInput(input: unknown): MissionScheduleInput {
  return missionScheduleInputSchema.parse(input);
}

export type MissionSchedule = {
  version: typeof MISSION_SCHEDULER_VERSION;
  missionId: string;
  selected: string[];
  decisions: WorkItemScheduleDecision[];
  capacity: {
    limit: number;
    requestedLanes: number;
    realActiveLanes: number;
    availableSlots: number;
    queueDepth: number;
  };
  budget: {
    totalTokens: number;
    executionTokens: number;
    consumedExecutionTokens: number;
    activeReservedTokens: number;
    newlyReservedTokens: number;
    remainingExecutionTokens: number;
    integrationReserveTokens: number;
    recoveryReserveTokens: number;
  };
  nextAction: string;
};

export function scheduleMissionReceipts(
  bundle: MissionReceiptBundle,
  input: MissionScheduleInput
): MissionSchedule {
  const limit = Math.max(0, Math.min(64, Math.floor(input.providerCapacity)));
  const lanes = input.activeLanes ?? [];
  const receiptById = new Map(
    bundle.workItems.map((receipt) => [receipt.workItemId, receipt] as const)
  );
  const observedRealLanes = new Set<string>();
  for (const lane of lanes) {
    if (!lane.providerEmitted) continue;
    const receipt = receiptById.get(lane.workItemId);
    if (!receipt) {
      throw new Error(`Provider-emitted lane references unknown work item ${lane.workItemId}`);
    }
    if (observedRealLanes.has(lane.workItemId)) {
      throw new Error(`Provider-emitted lane is duplicated for work item ${lane.workItemId}`);
    }
    if (lane.reservedTokens > receipt.budget.tokens) {
      throw new Error(`Provider-emitted lane exceeds the receipt budget for ${lane.workItemId}`);
    }
    observedRealLanes.add(lane.workItemId);
  }
  const realLanes = lanes.filter((lane) => lane.providerEmitted);
  const activeIds = new Set(realLanes.map((lane) => lane.workItemId));
  const activeReservedTokens = realLanes.reduce(
    (total, lane) => total + Math.max(0, Math.floor(lane.reservedTokens)),
    0
  );
  const consumed = Math.max(0, Math.floor(input.consumedExecutionTokens ?? 0));
  let availableTokens = Math.max(
    0,
    bundle.mission.budget.executionTokens - consumed - activeReservedTokens
  );
  let slots = Math.max(0, limit - realLanes.length);
  const decisions = new Map<string, WorkItemScheduleDecision>();
  const completed = new Set(
    bundle.workItems
      .filter((receipt) => receipt.status === "completed")
      .map((receipt) => receipt.workItemId)
  );
  const selected: string[] = [];
  const lockedScopes: Array<{ workItemId: string; scope: string }> = [];

  for (const lane of realLanes) {
    const receipt = bundle.workItems.find((candidate) => candidate.workItemId === lane.workItemId);
    if (!receipt) continue;
    for (const scope of receipt.scope.own) {
      lockedScopes.push({ workItemId: receipt.workItemId, scope });
    }
  }

  const candidates = bundle.workItems
    .map((receipt, order) => ({ receipt, order }))
    .sort((a, b) => b.receipt.priority - a.receipt.priority || a.order - b.order);

  for (const { receipt } of candidates) {
    const id = receipt.workItemId;
    if (["completed", "failed", "cancelled"].includes(receipt.status)) {
      decisions.set(id, decision(id, "terminal", "terminal", `Work item is ${receipt.status}`));
      continue;
    }
    if (activeIds.has(id)) {
      decisions.set(id, decision(id, "active", "active", "Provider-emitted lane is active"));
      continue;
    }
    if (receipt.status === "active") {
      decisions.set(
        id,
        decision(
          id,
          "waiting",
          "provider_evidence",
          "Durable status says active, but no provider-emitted lane proves execution"
        )
      );
      continue;
    }
    const missing = receipt.dependsOn.filter((dependency) => !completed.has(dependency));
    if (missing.length > 0) {
      decisions.set(
        id,
        decision(id, "waiting", "dependency", `Waiting for evidence-backed dependencies: ${missing.join(", ")}`)
      );
      continue;
    }
    const approval = input.approvals?.[id] ?? "approved";
    if (approval === "denied") {
      decisions.set(id, decision(id, "blocked", "approval_denied", "Required authority was denied"));
      continue;
    }
    if (approval === "pending") {
      decisions.set(id, decision(id, "waiting", "approval", "Waiting for scoped approval"));
      continue;
    }
    if (input.verifiedIsolation?.[id] !== true) {
      decisions.set(
        id,
        decision(id, "blocked", "isolation", "Verified isolated worktree evidence is missing")
      );
      continue;
    }
    const conflict = firstLockConflict(receipt, lockedScopes);
    if (conflict) {
      decisions.set(
        id,
        decision(
          id,
          "waiting",
          "repository_lock",
          `Write scope overlaps active work item ${conflict.workItemId}: ${conflict.scope}`
        )
      );
      continue;
    }
    if (receipt.budget.tokens > availableTokens) {
      decisions.set(
        id,
        decision(
          id,
          "waiting",
          "budget_reserve",
          `Needs ${receipt.budget.tokens} execution tokens; ${availableTokens} remain outside protected reserves`
        )
      );
      continue;
    }
    if (slots <= 0) {
      decisions.set(
        id,
        decision(id, "waiting", "capacity", `Provider capacity is full (${realLanes.length}/${limit})`)
      );
      continue;
    }

    selected.push(id);
    slots -= 1;
    availableTokens -= receipt.budget.tokens;
    for (const scope of receipt.scope.own) lockedScopes.push({ workItemId: id, scope });
    decisions.set(
      id,
      decision(id, "selected", "selected", "Dependencies, isolation, authority, capacity, locks, and reserve checks passed")
    );
  }

  const orderedDecisions = bundle.workItems.map(
    (receipt) =>
      decisions.get(receipt.workItemId) ??
      decision(receipt.workItemId, "waiting", "capacity", "Not scheduled")
  );
  const newlyReservedTokens = selected.reduce((total, workItemId) => {
    const receipt = receiptById.get(workItemId);
    return total + (receipt?.budget.tokens ?? 0);
  }, 0);
  const queueDepth = orderedDecisions.filter((entry) => entry.state === "waiting").length;
  const blocked = orderedDecisions.filter((entry) => entry.state === "blocked").length;

  return Object.freeze({
    version: MISSION_SCHEDULER_VERSION,
    missionId: bundle.mission.missionId,
    selected,
    decisions: orderedDecisions,
    capacity: {
      limit,
      requestedLanes: lanes.length,
      realActiveLanes: realLanes.length,
      availableSlots: slots,
      queueDepth,
    },
    budget: {
      totalTokens: bundle.mission.budget.totalTokens,
      executionTokens: bundle.mission.budget.executionTokens,
      consumedExecutionTokens: consumed,
      activeReservedTokens,
      newlyReservedTokens,
      remainingExecutionTokens: availableTokens,
      integrationReserveTokens: bundle.mission.budget.integrationReserveTokens,
      recoveryReserveTokens: bundle.mission.budget.recoveryReserveTokens,
    },
    nextAction:
      selected.length > 0
        ? `Launch ${selected.length} selected work item${selected.length === 1 ? "" : "s"}`
        : blocked > 0
          ? "Resolve the highest-priority isolation or approval blocker"
          : queueDepth > 0
            ? "Wait for dependency, capacity, lock, or execution-budget release"
            : "No schedulable work remains",
  });
}

function decision(
  workItemId: string,
  state: WorkItemScheduleDecision["state"],
  reason: ScheduleReason,
  detail: string
): WorkItemScheduleDecision {
  return { workItemId, state, reason, detail };
}

function firstLockConflict(
  receipt: WorkItemReceipt,
  locks: Array<{ workItemId: string; scope: string }>
): { workItemId: string; scope: string } | null {
  for (const owned of receipt.scope.own) {
    for (const lock of locks) {
      if (
        lock.workItemId !== receipt.workItemId &&
        (owned === lock.scope || owned.startsWith(`${lock.scope}/`) || lock.scope.startsWith(`${owned}/`))
      ) {
        return lock;
      }
    }
  }
  return null;
}
