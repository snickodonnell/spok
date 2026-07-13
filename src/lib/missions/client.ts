/**
 * Mission v1 UI client adapter — privileged local fetch only.
 *
 * Does not mutate domain/persist/validate. Reading is authority-neutral.
 * Evidence precedes spectacle: project leadership state for the control room
 * before any decorative team visualization.
 */

"use client";

import { localFetch } from "@/lib/local-api-client";
import type {
  DependencyEdge,
  Milestone,
  MilestoneStatus,
  Mission,
  MissionCheckpoint,
  MissionMeta,
  MissionNextAction,
  MissionSchemaVersion,
  MissionStatus,
  StatusSource,
  WorkItem,
  WorkItemStatus,
} from "./types";
import { MISSION_SCHEMA_VERSION } from "./types";

/** Default network budget for Mission control-room loads (actionable timeout). */
export const MISSION_UI_FETCH_TIMEOUT_MS = 8_000;

export type MissionClientErrorKind =
  | "timeout"
  | "network"
  | "http"
  | "invalid_response"
  | "not_found";

export type MissionClientError = {
  kind: MissionClientErrorKind;
  message: string;
  status?: number;
  code?: string;
};

export type MissionClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MissionClientError };

export type MissionListPayload = {
  version: MissionSchemaVersion;
  missions: MissionMeta[];
  authorityNeutral: true;
};

export type MissionDetailPayload = {
  version: MissionSchemaVersion;
  mission: Mission;
  authorityNeutral: true;
};

export type MissionCheckpointPayload = {
  version: MissionSchemaVersion;
  missionId: string;
  checkpoint: MissionCheckpoint;
  /** False when materialised only; undefined when a persisted checkpoint was read. */
  persisted?: boolean;
  authorityNeutral: true;
};

export type MissionClientDeps = {
  /** Override for tests; defaults to privileged localFetch. */
  fetchImpl?: typeof localFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function clientError(
  kind: MissionClientErrorKind,
  message: string,
  extra?: { status?: number; code?: string }
): MissionClientError {
  return { kind, message, ...extra };
}

async function withTimeout(
  input: string,
  init: RequestInit | undefined,
  deps: MissionClientDeps
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? localFetch;
  const timeoutMs = deps.timeoutMs ?? MISSION_UI_FETCH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (deps.signal) {
    if (deps.signal.aborted) ctrl.abort();
    else deps.signal.addEventListener("abort", onAbort, { once: true });
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  const timeoutPromise = new Promise<never>((_, reject) => {
    const fail = () => {
      if (timedOut) {
        reject(
          Object.assign(new Error("Mission API request timed out"), {
            name: "TimeoutError",
          })
        );
      } else {
        reject(
          Object.assign(new Error("Mission API request aborted"), {
            name: "AbortError",
          })
        );
      }
    };
    if (ctrl.signal.aborted) {
      fail();
      return;
    }
    ctrl.signal.addEventListener("abort", fail, { once: true });
  });

  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: ctrl.signal }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      ((err as { name?: string }).name === "TimeoutError" ||
        (err as { name?: string }).name === "AbortError")
    ) {
      throw err;
    }
    if (ctrl.signal.aborted) {
      if (timedOut) {
        throw Object.assign(new Error("Mission API request timed out"), {
          name: "TimeoutError",
        });
      }
      throw Object.assign(new Error("Mission API request aborted"), {
        name: "AbortError",
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

function mapFetchFailure(err: unknown): MissionClientError {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name?: string }).name);
    if (name === "TimeoutError") {
      return clientError(
        "timeout",
        "Mission store did not respond in time. Retry, or open Diagnostics if the host is down."
      );
    }
    if (name === "AbortError") {
      return clientError("network", "Mission request was cancelled.");
    }
  }
  const message =
    err instanceof Error && err.message.trim()
      ? err.message
      : "Could not reach the local Mission API.";
  return clientError("network", message);
}

async function readJson(
  res: Response
): Promise<{ body: Record<string, unknown>; parseOk: boolean }> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    return { body, parseOk: true };
  } catch {
    return { body: {}, parseOk: false };
  }
}

/**
 * GET /api/missions — list durable mission metas (authority-neutral).
 */
export async function fetchMissionList(
  deps: MissionClientDeps = {}
): Promise<MissionClientResult<MissionListPayload>> {
  try {
    const res = await withTimeout("/api/missions", { cache: "no-store" }, deps);
    const { body, parseOk } = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        error: clientError(
          res.status === 404 ? "not_found" : "http",
          typeof body.error === "string"
            ? body.error
            : `Failed to list missions (${res.status})`,
          {
            status: res.status,
            code: typeof body.code === "string" ? body.code : undefined,
          }
        ),
      };
    }
    if (!parseOk || !Array.isArray(body.missions)) {
      return {
        ok: false,
        error: clientError(
          "invalid_response",
          "Mission list response was malformed."
        ),
      };
    }
    return {
      ok: true,
      value: {
        version:
          typeof body.version === "number"
            ? (body.version as MissionSchemaVersion)
            : MISSION_SCHEMA_VERSION,
        missions: body.missions as MissionMeta[],
        authorityNeutral: true,
      },
    };
  } catch (err) {
    return { ok: false, error: mapFetchFailure(err) };
  }
}

/**
 * GET /api/missions/:id — full mission document (authority-neutral).
 */
export async function fetchMission(
  id: string,
  deps: MissionClientDeps = {}
): Promise<MissionClientResult<MissionDetailPayload>> {
  const safeId = encodeURIComponent(id);
  try {
    const res = await withTimeout(
      `/api/missions/${safeId}`,
      { cache: "no-store" },
      deps
    );
    const { body, parseOk } = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        error: clientError(
          res.status === 404 ? "not_found" : "http",
          typeof body.error === "string"
            ? body.error
            : `Failed to load mission (${res.status})`,
          {
            status: res.status,
            code: typeof body.code === "string" ? body.code : undefined,
          }
        ),
      };
    }
    if (!parseOk || !body.mission || typeof body.mission !== "object") {
      return {
        ok: false,
        error: clientError(
          "invalid_response",
          "Mission detail response was malformed."
        ),
      };
    }
    return {
      ok: true,
      value: {
        version:
          typeof body.version === "number"
            ? (body.version as MissionSchemaVersion)
            : MISSION_SCHEMA_VERSION,
        mission: body.mission as Mission,
        authorityNeutral: true,
      },
    };
  } catch (err) {
    return { ok: false, error: mapFetchFailure(err) };
  }
}

/**
 * GET /api/missions/:id/checkpoint — latest or materialised checkpoint.
 */
export async function fetchMissionCheckpoint(
  id: string,
  deps: MissionClientDeps = {}
): Promise<MissionClientResult<MissionCheckpointPayload>> {
  const safeId = encodeURIComponent(id);
  try {
    const res = await withTimeout(
      `/api/missions/${safeId}/checkpoint`,
      { cache: "no-store" },
      deps
    );
    const { body, parseOk } = await readJson(res);
    if (!res.ok) {
      return {
        ok: false,
        error: clientError(
          res.status === 404 ? "not_found" : "http",
          typeof body.error === "string"
            ? body.error
            : `Failed to load mission checkpoint (${res.status})`,
          {
            status: res.status,
            code: typeof body.code === "string" ? body.code : undefined,
          }
        ),
      };
    }
    if (!parseOk || !body.checkpoint || typeof body.checkpoint !== "object") {
      return {
        ok: false,
        error: clientError(
          "invalid_response",
          "Mission checkpoint response was malformed."
        ),
      };
    }
    return {
      ok: true,
      value: {
        version:
          typeof body.version === "number"
            ? (body.version as MissionSchemaVersion)
            : MISSION_SCHEMA_VERSION,
        missionId:
          typeof body.missionId === "string" ? body.missionId : id,
        checkpoint: body.checkpoint as MissionCheckpoint,
        persisted:
          typeof body.persisted === "boolean" ? body.persisted : undefined,
        authorityNeutral: true,
      },
    };
  } catch (err) {
    return { ok: false, error: mapFetchFailure(err) };
  }
}

// ── Pure leadership projection for the Missions control room ──────────────

export type WorkItemDependencyState =
  | "none"
  | "waiting"
  | "satisfied"
  | "blocked";

export type WorkItemEvidenceView = {
  id: string;
  title: string;
  status: WorkItemStatus;
  owner: string;
  ownerIsSpok: boolean;
  requestedCapability: string;
  dependencyState: WorkItemDependencyState;
  unsatisfiedDeps: string[];
  expectedEvidence: string[];
  terminalEvidenceRefs: string[];
  hasTerminalEvidence: boolean;
  /** Process exit without terminal outcome — never completion evidence. */
  processExitOnly: boolean;
  statusReason: string;
};

export type MilestoneEvidenceView = {
  id: string;
  title: string;
  status: MilestoneStatus;
  exitCriteria: string[];
  dependencyRefs: string[];
  unsatisfiedDeps: string[];
  workItems: WorkItemEvidenceView[];
  statusReason: string;
};

export type CheckpointEvidenceView = {
  id: string;
  at: number;
  completed: string[];
  active: string[];
  blocked: Array<{ id: string; reason: string }>;
  risks: string[];
  nextDecisions: string[];
  evidenceRefs: string[];
  changedAssumptions: string[];
  /** false = materialised only; true = durable; null = unknown. */
  persisted: boolean | null;
};

export type SpecialistPlanOwner = {
  owner: string;
  workItemIds: string[];
  /** Explicit: plan metadata is not a running agent without provider evidence. */
  note: string;
};

/**
 * Control-room leadership projection — pure, no I/O.
 * Spok remains leader; specialists are plan owners, not execution claims.
 */
export type MissionLeadershipView = {
  id: string;
  outcome: string;
  status: MissionStatus;
  statusLabel: string;
  statusReason: string;
  statusSource: StatusSource;
  nextAction: MissionNextAction;
  repository: string;
  definitionOfDone: string[];
  constraints: string[];
  milestones: MilestoneEvidenceView[];
  workItemsWithoutMilestone: WorkItemEvidenceView[];
  checkpoint: CheckpointEvidenceView | null;
  specialistPlanOwners: SpecialistPlanOwner[];
  authorityNeutral: true;
  /** Empty durable graph — not decorative progress. */
  isEmptyPlan: boolean;
};

export function missionStatusLabel(status: MissionStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "active":
      return "Active";
    case "blocked":
      return "Blocked";
    case "review_ready":
      return "Review ready";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function workItemStatusLabel(status: WorkItemStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "ready":
      return "Ready";
    case "active":
      return "Active";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function unsatisfiedIncoming(
  workItemId: string,
  dependencies: DependencyEdge[]
): DependencyEdge[] {
  return dependencies.filter((d) => d.to === workItemId && !d.satisfied);
}

function projectWorkItem(
  wi: WorkItem,
  dependencies: DependencyEdge[]
): WorkItemEvidenceView {
  const incoming = dependencies.filter((d) => d.to === wi.id);
  const unsatisfied = unsatisfiedIncoming(wi.id, dependencies);
  let dependencyState: WorkItemDependencyState = "none";
  if (incoming.length > 0) {
    if (unsatisfied.length === 0) dependencyState = "satisfied";
    else if (wi.status === "blocked") dependencyState = "blocked";
    else dependencyState = "waiting";
  }
  const terminalEvidenceRefs = wi.terminalOutcome?.evidenceRefs ?? [];
  const processExitOnly = Boolean(
    wi.processExit && !wi.terminalOutcome && wi.status !== "completed"
  );
  return {
    id: wi.id,
    title: wi.title,
    status: wi.status,
    owner: wi.owner,
    ownerIsSpok: wi.owner.trim().toLowerCase() === "spok",
    requestedCapability: wi.requestedCapability,
    dependencyState,
    unsatisfiedDeps: unsatisfied.map((d) => d.from),
    expectedEvidence: [...wi.expectedEvidence],
    terminalEvidenceRefs: [...terminalEvidenceRefs],
    hasTerminalEvidence: terminalEvidenceRefs.length > 0,
    processExitOnly,
    statusReason: wi.statusProvenance?.reason ?? "",
  };
}

function projectMilestone(
  ms: Milestone,
  mission: Mission
): MilestoneEvidenceView {
  const workItems = mission.workItems
    .filter((wi) => wi.milestoneId === ms.id || ms.workItemIds.includes(wi.id))
    .map((wi) => projectWorkItem(wi, mission.dependencies));
  // Deduplicate by id
  const seen = new Set<string>();
  const unique = workItems.filter((wi) => {
    if (seen.has(wi.id)) return false;
    seen.add(wi.id);
    return true;
  });
  const unsatisfiedDeps = ms.dependencyRefs.filter((ref) => {
    const edge = mission.dependencies.find(
      (d) => d.to === ms.id && d.from === ref
    );
    if (edge) return !edge.satisfied;
    // Dependency on work item / milestone id without edge: check work item terminal
    const wi = mission.workItems.find((w) => w.id === ref);
    if (wi) return wi.status !== "completed" || !wi.terminalOutcome;
    const other = mission.milestones.find((m) => m.id === ref);
    if (other) return other.status !== "completed";
    return true;
  });
  return {
    id: ms.id,
    title: ms.title,
    status: ms.status,
    exitCriteria: [...ms.exitCriteria],
    dependencyRefs: [...ms.dependencyRefs],
    unsatisfiedDeps,
    workItems: unique,
    statusReason: ms.statusProvenance?.reason ?? "",
  };
}

/**
 * Project durable mission + optional checkpoint into control-room leadership view.
 * Requested specialists appear as plan owners only — never as running agents.
 */
export function projectMissionLeadershipView(
  mission: Mission,
  checkpoint: MissionCheckpoint | null,
  opts?: { checkpointPersisted?: boolean | null }
): MissionLeadershipView {
  const milestones = mission.milestones.map((ms) =>
    projectMilestone(ms, mission)
  );
  const assigned = new Set(
    milestones.flatMap((ms) => ms.workItems.map((wi) => wi.id))
  );
  const workItemsWithoutMilestone = mission.workItems
    .filter((wi) => !assigned.has(wi.id) && !wi.milestoneId)
    .map((wi) => projectWorkItem(wi, mission.dependencies));

  const ownerMap = new Map<string, string[]>();
  for (const wi of mission.workItems) {
    const owner = wi.owner.trim() || "unknown";
    if (owner.toLowerCase() === "spok") continue;
    const list = ownerMap.get(owner) ?? [];
    list.push(wi.id);
    ownerMap.set(owner, list);
  }
  const specialistPlanOwners: SpecialistPlanOwner[] = Array.from(
    ownerMap.entries()
  ).map(([owner, workItemIds]) => ({
    owner,
    workItemIds,
    note: "Plan owner only · not a running agent without provider lane evidence",
  }));

  let checkpointView: CheckpointEvidenceView | null = null;
  if (checkpoint) {
    const persisted =
      opts?.checkpointPersisted === undefined
        ? null
        : opts.checkpointPersisted;
    checkpointView = {
      id: checkpoint.id,
      at: checkpoint.at,
      completed: [...checkpoint.completed],
      active: [...checkpoint.active],
      blocked: checkpoint.blocked.map((b) => ({ ...b })),
      risks: [...checkpoint.risks],
      nextDecisions: [...checkpoint.nextDecisions],
      evidenceRefs: [...checkpoint.evidenceRefs],
      changedAssumptions: [...checkpoint.changedAssumptions],
      persisted,
    };
  }

  return {
    id: mission.id,
    outcome: mission.outcome,
    status: mission.status,
    statusLabel: missionStatusLabel(mission.status),
    statusReason: mission.statusProvenance?.reason ?? "",
    statusSource: mission.statusProvenance?.source ?? "system",
    nextAction: { ...mission.nextAction },
    repository: mission.repository,
    definitionOfDone: [...mission.definitionOfDone],
    constraints: [...mission.constraints],
    milestones,
    workItemsWithoutMilestone,
    checkpoint: checkpointView,
    specialistPlanOwners,
    authorityNeutral: true,
    isEmptyPlan:
      mission.milestones.length === 0 && mission.workItems.length === 0,
  };
}

/** Actionable copy for list/detail load failures (no infinite spinner). */
export function missionLoadRecoveryMessage(error: MissionClientError): {
  title: string;
  body: string;
  primaryAction: "retry" | "diagnostics";
} {
  if (error.kind === "timeout") {
    return {
      title: "Mission store timed out",
      body: error.message,
      primaryAction: "retry",
    };
  }
  if (error.kind === "not_found") {
    return {
      title: "Mission not found",
      body: error.message,
      primaryAction: "retry",
    };
  }
  if (error.kind === "http") {
    return {
      title: "Mission API refused the request",
      body: error.message,
      primaryAction: "retry",
    };
  }
  return {
    title: "Could not load durable missions",
    body: error.message,
    primaryAction: "retry",
  };
}

/** Empty-store copy — never invent decorative progress. */
export function missionEmptyStoreMessage(): {
  title: string;
  body: string;
} {
  return {
    title: "No durable missions yet",
    body: "Mission v1 records appear here with outcome, milestones, evidence, risks, and next action. Decorative team maps never substitute for a durable plan.",
  };
}
