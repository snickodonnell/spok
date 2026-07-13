/**
 * Pure checkpoint projection for Mission v1.
 * Materializes completed/active/blocked, evidence, risks, next decisions
 * without replaying a full transcript (500ms-friendly).
 */

import type {
  Mission,
  MissionCheckpoint,
  Milestone,
  WorkItem,
} from "./types";

export type CheckpointMaterializeInput = {
  mission: Mission;
  /** Optional override clock for deterministic tests. */
  at?: number;
  /** Optional stable checkpoint id (default: ckpt_<missionId>_<at>). */
  id?: string;
  changedAssumptions?: string[];
  risks?: string[];
  nextDecisions?: string[];
};

function isTerminalWork(status: WorkItem["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isActiveWork(status: WorkItem["status"]): boolean {
  return status === "active" || status === "ready";
}

function collectEvidence(mission: Mission): string[] {
  const refs = new Set<string>();
  for (const edge of mission.dependencies) {
    for (const e of edge.evidenceRefs) {
      if (e.trim()) refs.add(e.trim());
    }
  }
  for (const wi of mission.workItems) {
    for (const e of wi.expectedEvidence) {
      if (e.trim()) refs.add(e.trim());
    }
    if (wi.terminalOutcome) {
      for (const e of wi.terminalOutcome.evidenceRefs) {
        if (e.trim()) refs.add(e.trim());
      }
    }
  }
  for (const ms of mission.milestones) {
    if (ms.terminalOutcome) {
      for (const e of ms.terminalOutcome.evidenceRefs) {
        if (e.trim()) refs.add(e.trim());
      }
    }
  }
  return Array.from(refs).sort();
}

function blockedReason(wi: WorkItem, mission: Mission): string {
  if (wi.statusProvenance.reason.trim()) return wi.statusProvenance.reason;
  const unsatisfied = mission.dependencies.filter(
    (d) => d.to === wi.id && !d.satisfied
  );
  if (unsatisfied.length > 0) {
    return `Blocked on dependencies: ${unsatisfied.map((d) => d.from).join(", ")}`;
  }
  if (wi.budgetReceipt?.exhausted?.length) {
    return `Budget exhausted: ${wi.budgetReceipt.exhausted.join(", ")}`;
  }
  if (wi.retries.used >= wi.retries.max && wi.status === "blocked") {
    return `Retries exhausted (${wi.retries.used}/${wi.retries.max})`;
  }
  return "Blocked";
}

function defaultNextDecisions(mission: Mission, blocked: MissionCheckpoint["blocked"]): string[] {
  const decisions: string[] = [];
  if (mission.nextAction?.label) {
    decisions.push(mission.nextAction.label);
  }
  for (const b of blocked.slice(0, 5)) {
    decisions.push(`Resolve blocker ${b.id}: ${b.reason}`);
  }
  const incompleteDoD = mission.definitionOfDone.filter((d) => d.trim());
  if (
    mission.status === "review_ready" ||
    mission.status === "active"
  ) {
    for (const d of incompleteDoD.slice(0, 3)) {
      decisions.push(`Verify definition of done: ${d}`);
    }
  }
  return decisions;
}

function defaultRisks(mission: Mission, blocked: MissionCheckpoint["blocked"]): string[] {
  const risks: string[] = [];
  if (blocked.length > 0) {
    risks.push(`${blocked.length} blocked work item(s)`);
  }
  for (const wi of mission.workItems) {
    if (wi.budgetReceipt?.exhausted?.length) {
      risks.push(`Work item ${wi.id} budget pressure: ${wi.budgetReceipt.exhausted.join(", ")}`);
    }
    if (wi.retries.max > 0 && wi.retries.used >= wi.retries.max) {
      risks.push(`Work item ${wi.id} has no retries remaining`);
    }
    // Process exit without terminal outcome is a risk signal
    if (wi.processExit && !wi.terminalOutcome && !isTerminalWork(wi.status)) {
      risks.push(
        `Work item ${wi.id} has process exit (${wi.processExit.exitCode}) without terminal outcome`
      );
    }
  }
  for (const edge of mission.dependencies) {
    if (edge.satisfied && edge.evidenceRefs.length === 0) {
      // Should be impossible after validation; surface if corrupted
      risks.push(`Dependency ${edge.id} marked satisfied without evidence`);
    }
  }
  return risks;
}

/**
 * Project a MissionCheckpoint from mission state alone.
 * Pure: no I/O, no transcript, no session replay.
 */
export function materializeCheckpoint(
  input: CheckpointMaterializeInput
): MissionCheckpoint {
  const { mission } = input;
  const at = input.at ?? Date.now();
  const completed: string[] = [];
  const active: string[] = [];
  const blocked: MissionCheckpoint["blocked"] = [];

  for (const ms of mission.milestones as Milestone[]) {
    if (ms.status === "completed") completed.push(ms.id);
    else if (ms.status === "active") active.push(ms.id);
    else if (ms.status === "blocked") {
      blocked.push({
        id: ms.id,
        reason: ms.statusProvenance.reason || "Milestone blocked",
      });
    }
  }

  for (const wi of mission.workItems) {
    if (wi.status === "completed") completed.push(wi.id);
    else if (isActiveWork(wi.status)) active.push(wi.id);
    else if (wi.status === "blocked") {
      blocked.push({ id: wi.id, reason: blockedReason(wi, mission) });
    } else if (wi.status === "failed") {
      // Failed is terminal for the attempt but surfaces as risk context
      completed.push(wi.id);
    }
  }

  const evidenceRefs = collectEvidence(mission);
  const risks = input.risks ?? defaultRisks(mission, blocked);
  const nextDecisions =
    input.nextDecisions ?? defaultNextDecisions(mission, blocked);
  const changedAssumptions = input.changedAssumptions ?? [];

  return {
    version: 1,
    id: input.id ?? `ckpt_${mission.id}_${at}`,
    missionId: mission.id,
    at,
    completed,
    active,
    blocked,
    changedAssumptions,
    evidenceRefs,
    risks,
    nextDecisions,
  };
}

/**
 * Round-trip helper: serialize/parse checkpoint without mission transcript.
 * Used by tests and restore paths to prove no full-history dependency.
 */
export function checkpointToJSON(checkpoint: MissionCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function checkpointFromJSON(raw: string): MissionCheckpoint | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const o = value as Record<string, unknown>;
    if (o.version !== 1 || typeof o.id !== "string" || typeof o.missionId !== "string") {
      return null;
    }
    if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
    if (!Array.isArray(o.completed) || !Array.isArray(o.active)) return null;
    if (!Array.isArray(o.blocked) || !Array.isArray(o.evidenceRefs)) return null;
    return value as MissionCheckpoint;
  } catch {
    return null;
  }
}
