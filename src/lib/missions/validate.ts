/**
 * Mission v1 validation: shape, dependency evidence rules, authority bounds,
 * retry bounds, and terminal vs process-exit provenance.
 */

import path from "path";
import { canonicalizePath } from "@/lib/security/paths";
import { redactSecrets } from "@/lib/security/secrets";
import {
  assertWorkItemBudgetWithinMission,
  sanitizeBudgetLimits,
} from "./budgets";
import type {
  AuthorityReceipt,
  DependencyEdge,
  Milestone,
  Mission,
  MissionCreateInput,
  MissionDomainErrorCode,
  MissionNextAction,
  MissionStatus,
  MilestoneStatus,
  ProcessExitProvenance,
  StatusProvenance,
  StatusSource,
  TerminalOutcomeProvenance,
  WorkItem,
  WorkItemStatus,
} from "./types";
import { MISSION_SAFE_ID } from "./types";

export type MissionValidateResult =
  | { ok: true; mission: Mission; redactions: number }
  | { ok: false; code: MissionDomainErrorCode; error: string };

export type DomainOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MissionDomainErrorCode; error: string };

const MISSION_STATUSES = new Set<MissionStatus>([
  "draft",
  "active",
  "blocked",
  "review_ready",
  "completed",
  "failed",
  "cancelled",
  "archived",
]);
const MILESTONE_STATUSES = new Set<MilestoneStatus>([
  "pending",
  "active",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
const WORK_STATUSES = new Set<WorkItemStatus>([
  "pending",
  "ready",
  "active",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
const STATUS_SOURCES = new Set<StatusSource>([
  "user",
  "spok",
  "system",
  "import",
  "restore",
]);
const TERMINAL_OUTCOMES = new Set([
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "superseded",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return MISSION_SAFE_ID.test(trimmed) ? trimmed : undefined;
}

function redactAndLimit(
  value: unknown,
  max: number
): { text?: string; count: number } {
  if (typeof value !== "string") return { count: 0 };
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return { count: 0 };
  const redacted = redactSecrets(trimmed);
  return { text: redacted.text, count: redacted.count };
}

function absolutePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value.trim())) {
    return undefined;
  }
  return canonicalizePath(value.trim());
}

function stringList(
  value: unknown,
  maxItems: number,
  maxLen: number
): { items: string[]; redactions: number } {
  if (!Array.isArray(value)) return { items: [], redactions: 0 };
  const items: string[] = [];
  let redactions = 0;
  for (const entry of value.slice(0, maxItems)) {
    const r = redactAndLimit(entry, maxLen);
    if (r.text) {
      items.push(r.text);
      redactions += r.count;
    }
  }
  return { items, redactions };
}

function sanitizeStatusProvenance(
  value: unknown,
  fallback: StatusProvenance
): { provenance: StatusProvenance; redactions: number } {
  if (!isObject(value)) return { provenance: fallback, redactions: 0 };
  const at = finiteTime(value.at) ?? fallback.at;
  const source = STATUS_SOURCES.has(value.source as StatusSource)
    ? (value.source as StatusSource)
    : fallback.source;
  const reason = redactAndLimit(value.reason, 2_000);
  return {
    provenance: {
      at,
      source,
      reason: reason.text || fallback.reason,
    },
    redactions: reason.count,
  };
}

function sanitizeProcessExit(
  value: unknown
): ProcessExitProvenance | undefined {
  if (!isObject(value) || value.kind !== "process_exit") return undefined;
  const at = finiteTime(value.at);
  if (at === undefined) return undefined;
  const exitCode =
    value.exitCode === null
      ? null
      : typeof value.exitCode === "number" && Number.isInteger(value.exitCode)
        ? Math.max(-1, Math.min(255, value.exitCode))
        : undefined;
  if (exitCode === undefined && value.exitCode !== null) return undefined;
  return {
    kind: "process_exit",
    exitCode: exitCode ?? null,
    at,
    sessionId: safeId(value.sessionId),
    jobId: safeId(value.jobId),
    signal:
      typeof value.signal === "string"
        ? value.signal.trim().slice(0, 64) || undefined
        : undefined,
  };
}

function sanitizeTerminalOutcome(
  value: unknown
): { outcome?: TerminalOutcomeProvenance; redactions: number; error?: string } {
  if (value === undefined) return { redactions: 0 };
  if (!isObject(value) || value.kind !== "terminal_outcome") {
    return { redactions: 0, error: "Terminal outcome must use kind terminal_outcome" };
  }
  if (!TERMINAL_OUTCOMES.has(value.outcome as string)) {
    return { redactions: 0, error: "Invalid terminal outcome kind" };
  }
  const at = finiteTime(value.at);
  if (at === undefined) {
    return { redactions: 0, error: "Terminal outcome requires at" };
  }
  const reason = redactAndLimit(value.reason, 2_000);
  if (!reason.text) {
    return { redactions: reason.count, error: "Terminal outcome requires reason" };
  }
  const evidence = stringList(value.evidenceRefs, 64, 512);
  if (value.outcome === "completed" && evidence.items.length === 0) {
    return {
      redactions: reason.count + evidence.redactions,
      error: "Completed terminal outcome requires evidenceRefs",
    };
  }
  return {
    redactions: reason.count + evidence.redactions,
    outcome: {
      kind: "terminal_outcome",
      outcome: value.outcome as TerminalOutcomeProvenance["outcome"],
      at,
      reason: reason.text,
      evidenceRefs: evidence.items,
      processExit: sanitizeProcessExit(value.processExit),
    },
  };
}

function sanitizeAuthority(
  value: unknown,
  repositoryFallback?: string
): { receipt?: AuthorityReceipt; redactions: number; error?: string } {
  if (value === undefined) return { redactions: 0 };
  if (!isObject(value)) {
    return { redactions: 0, error: "Authority receipt must be an object" };
  }
  const policyRef = redactAndLimit(value.policyRef, 256);
  if (!policyRef.text) {
    return { redactions: policyRef.count, error: "Authority requires policyRef" };
  }
  const repository =
    absolutePath(value.repository) ??
    (repositoryFallback ? absolutePath(repositoryFallback) : undefined);
  if (!repository) {
    return {
      redactions: policyRef.count,
      error: "Authority requires absolute repository path",
    };
  }
  const worktreePath =
    value.worktreePath === undefined
      ? undefined
      : absolutePath(value.worktreePath);
  if (value.worktreePath !== undefined && !worktreePath) {
    return { redactions: policyRef.count, error: "Invalid worktree path in authority" };
  }
  const capabilities: string[] = [];
  if (Array.isArray(value.capabilities)) {
    for (const c of value.capabilities.slice(0, 32)) {
      const id = safeId(c) ?? (typeof c === "string" ? c.trim().slice(0, 64) : "");
      if (id && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) {
        capabilities.push(id);
      }
    }
  }
  const grantedAt = finiteTime(value.grantedAt) ?? Date.now();
  return {
    redactions: policyRef.count,
    receipt: {
      version: 1,
      policyRef: policyRef.text,
      capabilities,
      repository,
      worktreePath,
      grantedAt,
      authorityNeutralRestore: true,
    },
  };
}

function sanitizeNextAction(
  value: unknown,
  fallback: MissionNextAction
): { action: MissionNextAction; redactions: number } {
  if (!isObject(value)) return { action: fallback, redactions: 0 };
  const kind = redactAndLimit(value.kind, 64);
  const label = redactAndLimit(value.label, 256);
  return {
    action: {
      kind: kind.text || fallback.kind,
      label: label.text || fallback.label,
      workItemId: safeId(value.workItemId),
      milestoneId: safeId(value.milestoneId),
    },
    redactions: kind.count + label.count,
  };
}

function defaultProvenance(at: number, source: StatusSource, reason: string): StatusProvenance {
  return { at, source, reason };
}

/**
 * Refuse authority over-request: child capabilities must be ⊆ mission capabilities
 * when the mission has an authority receipt with a non-empty capability list.
 * Child policyRef must match mission policyRef when both set.
 */
export function assertAuthorityWithinParent(
  parent: AuthorityReceipt | undefined,
  child: AuthorityReceipt | undefined,
  childLabel: string
): DomainOpResult<true> {
  if (!child) return { ok: true, value: true };
  if (!parent) {
    // No mission authority yet — work item may carry its own bounded receipt
    return { ok: true, value: true };
  }
  if (child.policyRef !== parent.policyRef) {
    return {
      ok: false,
      code: "authority_over_request",
      error: `${childLabel}: policyRef "${child.policyRef}" does not match mission "${parent.policyRef}"`,
    };
  }
  if (parent.capabilities.length > 0) {
    const allowed = new Set(parent.capabilities);
    for (const cap of child.capabilities) {
      if (!allowed.has(cap)) {
        return {
          ok: false,
          code: "authority_over_request",
          error: `${childLabel}: capability "${cap}" not granted by mission authority`,
        };
      }
    }
  }
  return { ok: true, value: true };
}

/**
 * Requested capability on a work item must be in mission authority when present.
 */
export function assertRequestedCapabilityAllowed(
  missionAuthority: AuthorityReceipt | undefined,
  requestedCapability: string,
  workItemId: string
): DomainOpResult<true> {
  if (!missionAuthority || missionAuthority.capabilities.length === 0) {
    return { ok: true, value: true };
  }
  if (!missionAuthority.capabilities.includes(requestedCapability)) {
    return {
      ok: false,
      code: "authority_over_request",
      error: `Work item ${workItemId}: requested capability "${requestedCapability}" denied by mission authority`,
    };
  }
  return { ok: true, value: true };
}

/**
 * Completing a dependency edge requires non-empty evidence when requiresEvidence.
 * Process exit alone never satisfies an edge.
 */
export function assertDependencySatisfaction(
  edge: DependencyEdge,
  opts?: { processExitOnly?: boolean }
): DomainOpResult<DependencyEdge> {
  if (!edge.satisfied) {
    return { ok: true, value: edge };
  }
  if (opts?.processExitOnly) {
    return {
      ok: false,
      code: "missing_evidence",
      error: `Dependency ${edge.id}: process exit alone cannot satisfy a dependency`,
    };
  }
  if (edge.requiresEvidence && edge.evidenceRefs.length === 0) {
    return {
      ok: false,
      code: "missing_evidence",
      error: `Dependency ${edge.id}: cannot mark satisfied without evidenceRefs`,
    };
  }
  return { ok: true, value: edge };
}

/**
 * Mark a work item completed only with terminal outcome + evidence.
 * Process exit is never sufficient.
 */
export function assertWorkItemCompletion(
  workItem: WorkItem
): DomainOpResult<WorkItem> {
  if (workItem.status !== "completed") {
    return { ok: true, value: workItem };
  }
  if (!workItem.terminalOutcome) {
    return {
      ok: false,
      code: "missing_evidence",
      error: `Work item ${workItem.id}: completed status requires terminalOutcome (process exit is insufficient)`,
    };
  }
  if (workItem.terminalOutcome.outcome !== "completed") {
    return {
      ok: false,
      code: "invalid_status",
      error: `Work item ${workItem.id}: status completed requires terminal outcome completed`,
    };
  }
  if (workItem.terminalOutcome.evidenceRefs.length === 0) {
    return {
      ok: false,
      code: "missing_evidence",
      error: `Work item ${workItem.id}: completion requires evidenceRefs`,
    };
  }
  return { ok: true, value: workItem };
}

/**
 * Attempt a retry: refuse when used would exceed max.
 */
export function assertRetryAllowed(
  workItem: Pick<WorkItem, "id" | "retries">
): DomainOpResult<true> {
  if (workItem.retries.used >= workItem.retries.max) {
    return {
      ok: false,
      code: "retry_exhausted",
      error: `Work item ${workItem.id}: retries exhausted (${workItem.retries.used}/${workItem.retries.max})`,
    };
  }
  return { ok: true, value: true };
}

function sanitizeMilestone(
  value: unknown,
  now: number
): { milestone?: Milestone; redactions: number; error?: string } {
  if (!isObject(value)) return { redactions: 0, error: "Milestone must be an object" };
  const id = safeId(value.id);
  if (!id) return { redactions: 0, error: "Invalid milestone id" };
  const title = redactAndLimit(value.title, 200);
  if (!title.text) return { redactions: title.count, error: "Milestone requires title" };
  const status = MILESTONE_STATUSES.has(value.status as MilestoneStatus)
    ? (value.status as MilestoneStatus)
    : "pending";
  const exitCriteria = stringList(value.exitCriteria, 32, 512);
  const dependencyRefs: string[] = [];
  if (Array.isArray(value.dependencyRefs)) {
    for (const d of value.dependencyRefs.slice(0, 64)) {
      const idRef = safeId(d);
      if (idRef) dependencyRefs.push(idRef);
    }
  }
  const workItemIds: string[] = [];
  if (Array.isArray(value.workItemIds)) {
    for (const d of value.workItemIds.slice(0, 128)) {
      const idRef = safeId(d);
      if (idRef) workItemIds.push(idRef);
    }
  }
  const prov = sanitizeStatusProvenance(
    value.statusProvenance,
    defaultProvenance(now, "spok", `Milestone ${status}`)
  );
  const term = sanitizeTerminalOutcome(value.terminalOutcome);
  if (term.error) return { redactions: title.count + prov.redactions, error: term.error };
  if (status === "completed") {
    if (!term.outcome || term.outcome.outcome !== "completed") {
      return {
        redactions: title.count + prov.redactions + term.redactions,
        error: `Milestone ${id}: completed requires terminal outcome with evidence`,
      };
    }
    if (term.outcome.evidenceRefs.length === 0) {
      return {
        redactions: title.count + prov.redactions + term.redactions,
        error: `Milestone ${id}: completed requires evidenceRefs`,
      };
    }
  }
  return {
    redactions:
      title.count + exitCriteria.redactions + prov.redactions + term.redactions,
    milestone: {
      id,
      title: title.text,
      exitCriteria: exitCriteria.items,
      status,
      statusProvenance: prov.provenance,
      dependencyRefs,
      workItemIds,
      terminalOutcome: term.outcome,
    },
  };
}

function sanitizeWorkItem(
  value: unknown,
  now: number,
  missionBudgets: Mission["budgets"],
  missionAuthority?: AuthorityReceipt
): { workItem?: WorkItem; redactions: number; error?: string; code?: MissionDomainErrorCode } {
  if (!isObject(value)) return { redactions: 0, error: "Work item must be an object" };
  const id = safeId(value.id);
  if (!id) return { redactions: 0, error: "Invalid work item id", code: "invalid_id" };
  const title = redactAndLimit(value.title, 200);
  if (!title.text) {
    return { redactions: title.count, error: "Work item requires title" };
  }
  const owner = redactAndLimit(value.owner, 80);
  if (!owner.text) {
    return { redactions: title.count + owner.count, error: "Work item requires owner" };
  }
  const requested =
    safeId(value.requestedCapability) ??
    (typeof value.requestedCapability === "string"
      ? value.requestedCapability.trim().slice(0, 64)
      : "");
  if (!requested || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(requested)) {
    return {
      redactions: title.count + owner.count,
      error: "Work item requires requestedCapability",
      code: "invalid_mission",
    };
  }
  const capCheck = assertRequestedCapabilityAllowed(missionAuthority, requested, id);
  if (!capCheck.ok) {
    return {
      redactions: title.count + owner.count,
      error: capCheck.error,
      code: capCheck.code,
    };
  }

  const status = WORK_STATUSES.has(value.status as WorkItemStatus)
    ? (value.status as WorkItemStatus)
    : "pending";
  const deps: string[] = [];
  if (Array.isArray(value.dependencies)) {
    for (const d of value.dependencies.slice(0, 64)) {
      const idRef = safeId(d);
      if (idRef) deps.push(idRef);
    }
  }
  const expectedEvidence = stringList(value.expectedEvidence, 32, 512);
  const budgets = sanitizeBudgetLimits(value.budgets);
  const maxRetries =
    typeof value.retries === "object" &&
    value.retries &&
    typeof (value.retries as { max?: unknown }).max === "number"
      ? Math.max(0, Math.min(100, Math.floor((value.retries as { max: number }).max)))
      : typeof budgets.retries === "number"
        ? budgets.retries
        : 0;
  const usedRetries =
    typeof value.retries === "object" &&
    value.retries &&
    typeof (value.retries as { used?: unknown }).used === "number"
      ? Math.max(0, Math.min(100, Math.floor((value.retries as { used: number }).used)))
      : 0;

  const budgetCheck = assertWorkItemBudgetWithinMission(
    { budgets: missionBudgets },
    { id, budgets, retries: { max: maxRetries, used: usedRetries } }
  );
  if (!budgetCheck.ok) {
    return {
      redactions: title.count + owner.count + expectedEvidence.redactions,
      error: budgetCheck.error,
      code: budgetCheck.code,
    };
  }

  const authority = sanitizeAuthority(value.authorityReceipt);
  if (authority.error) {
    return {
      redactions: title.count + owner.count + authority.redactions,
      error: authority.error,
      code: "authority_over_request",
    };
  }
  const authCheck = assertAuthorityWithinParent(
    missionAuthority,
    authority.receipt,
    `Work item ${id}`
  );
  if (!authCheck.ok) {
    return {
      redactions: title.count + owner.count + authority.redactions,
      error: authCheck.error,
      code: authCheck.code,
    };
  }

  const prov = sanitizeStatusProvenance(
    value.statusProvenance,
    defaultProvenance(now, "spok", `Work item ${status}`)
  );
  const term = sanitizeTerminalOutcome(value.terminalOutcome);
  if (term.error) {
    return {
      redactions: title.count + owner.count + prov.redactions + term.redactions,
      error: term.error,
      code: "missing_evidence",
    };
  }
  const processExit = sanitizeProcessExit(value.processExit);

  const workItem: WorkItem = {
    id,
    milestoneId: safeId(value.milestoneId),
    title: title.text,
    owner: owner.text,
    dependencies: deps,
    requestedCapability: requested,
    authorityReceipt: authority.receipt,
    budgets,
    budgetReceipt: budgetCheck.receipt,
    expectedEvidence: expectedEvidence.items,
    retries: { max: maxRetries, used: usedRetries },
    status,
    statusProvenance: prov.provenance,
    terminalOutcome: term.outcome,
    processExit,
  };

  const completion = assertWorkItemCompletion(workItem);
  if (!completion.ok) {
    return {
      redactions:
        title.count +
        owner.count +
        expectedEvidence.redactions +
        prov.redactions +
        term.redactions +
        authority.redactions,
      error: completion.error,
      code: completion.code,
    };
  }

  return {
    redactions:
      title.count +
      owner.count +
      expectedEvidence.redactions +
      prov.redactions +
      term.redactions +
      authority.redactions,
    workItem,
  };
}

function sanitizeDependency(
  value: unknown
): { edge?: DependencyEdge; redactions: number; error?: string; code?: MissionDomainErrorCode } {
  if (!isObject(value)) return { redactions: 0, error: "Dependency must be an object" };
  const id = safeId(value.id);
  const from = safeId(value.from);
  const to = safeId(value.to);
  if (!id || !from || !to) {
    return { redactions: 0, error: "Dependency requires id, from, to", code: "invalid_dependency" };
  }
  if (from === to) {
    return {
      redactions: 0,
      error: `Dependency ${id}: from and to must differ`,
      code: "invalid_dependency",
    };
  }
  const evidence = stringList(value.evidenceRefs, 64, 512);
  const satisfied = value.satisfied === true;
  const edge: DependencyEdge = {
    id,
    from,
    to,
    requiresEvidence: true,
    evidenceRefs: evidence.items,
    satisfied,
  };
  const check = assertDependencySatisfaction(edge);
  if (!check.ok) {
    return {
      redactions: evidence.redactions,
      error: check.error,
      code: check.code,
    };
  }
  return { redactions: evidence.redactions, edge };
}

/**
 * Convert untrusted input into the durable Mission v1 shape.
 * Unknown credential/env fields are never retained.
 */
export function sanitizeMission(input: unknown, now = Date.now()): MissionValidateResult {
  if (!isObject(input)) {
    return { ok: false, code: "invalid_mission", error: "Mission must be an object" };
  }
  if (input.version !== undefined && input.version !== 1) {
    return { ok: false, code: "invalid_mission", error: "Unsupported mission schema version" };
  }
  const id = safeId(input.id);
  if (!id) return { ok: false, code: "invalid_id", error: "Invalid mission id" };

  const outcome = redactAndLimit(input.outcome, 4_000);
  if (!outcome.text) {
    return { ok: false, code: "invalid_mission", error: "Mission requires outcome" };
  }
  const policyRef = redactAndLimit(input.policyRef, 256);
  if (!policyRef.text) {
    return { ok: false, code: "invalid_mission", error: "Mission requires policyRef" };
  }
  const repository = absolutePath(input.repository);
  if (!repository) {
    return {
      ok: false,
      code: "invalid_mission",
      error: "Mission requires absolute repository path",
    };
  }
  const worktreePath =
    input.worktreePath === undefined ? undefined : absolutePath(input.worktreePath);
  if (input.worktreePath !== undefined && !worktreePath) {
    return { ok: false, code: "invalid_mission", error: "Invalid worktree path" };
  }

  const status = MISSION_STATUSES.has(input.status as MissionStatus)
    ? (input.status as MissionStatus)
    : "draft";
  const createdAt = finiteTime(input.createdAt) ?? now;
  const updatedAt = finiteTime(input.updatedAt) ?? createdAt;
  const definitionOfDone = stringList(input.definitionOfDone, 32, 512);
  const constraints = stringList(input.constraints, 32, 512);
  const budgets = sanitizeBudgetLimits(input.budgets);

  const authority = sanitizeAuthority(input.authority, repository);
  if (authority.error) {
    return {
      ok: false,
      code: "authority_over_request",
      error: authority.error,
    };
  }

  let redactions =
    outcome.count +
    policyRef.count +
    definitionOfDone.redactions +
    constraints.redactions +
    authority.redactions;

  const prov = sanitizeStatusProvenance(
    input.statusProvenance,
    defaultProvenance(updatedAt, "spok", `Mission ${status}`)
  );
  redactions += prov.redactions;

  const next = sanitizeNextAction(input.nextAction, {
    kind: "inspect",
    label: "Review mission plan",
  });
  redactions += next.redactions;

  const milestones: Milestone[] = [];
  if (Array.isArray(input.milestones)) {
    for (const raw of input.milestones.slice(0, 64)) {
      const m = sanitizeMilestone(raw, now);
      redactions += m.redactions;
      if (m.error || !m.milestone) {
        return {
          ok: false,
          code: "invalid_mission",
          error: m.error || "Invalid milestone",
        };
      }
      milestones.push(m.milestone);
    }
  }

  const workItems: WorkItem[] = [];
  if (Array.isArray(input.workItems)) {
    for (const raw of input.workItems.slice(0, 256)) {
      const w = sanitizeWorkItem(raw, now, budgets, authority.receipt);
      redactions += w.redactions;
      if (w.error || !w.workItem) {
        return {
          ok: false,
          code: w.code || "invalid_mission",
          error: w.error || "Invalid work item",
        };
      }
      workItems.push(w.workItem);
    }
  }

  const dependencies: DependencyEdge[] = [];
  if (Array.isArray(input.dependencies)) {
    for (const raw of input.dependencies.slice(0, 512)) {
      const d = sanitizeDependency(raw);
      redactions += d.redactions;
      if (d.error || !d.edge) {
        return {
          ok: false,
          code: d.code || "invalid_dependency",
          error: d.error || "Invalid dependency",
        };
      }
      dependencies.push(d.edge);
    }
  }

  // Known node ids for dependency reference integrity (soft: warn via refusal if edge points nowhere when satisfied)
  const nodeIds = new Set<string>([
    ...milestones.map((m) => m.id),
    ...workItems.map((w) => w.id),
  ]);
  for (const edge of dependencies) {
    if (edge.satisfied && (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))) {
      return {
        ok: false,
        code: "invalid_dependency",
        error: `Dependency ${edge.id}: satisfied edge requires known from/to nodes`,
      };
    }
  }

  let importMeta: Mission["importMeta"];
  if (isObject(input.importMeta)) {
    const importedAt = finiteTime(input.importMeta.importedAt) ?? now;
    const source = redactAndLimit(input.importMeta.source, 256);
    redactions += source.count;
    importMeta = {
      importedAt,
      source: source.text,
      authorityNeutral: true,
    };
  }

  const mission: Mission = {
    version: 1,
    id,
    projectId: safeId(input.projectId),
    outcome: outcome.text,
    definitionOfDone: definitionOfDone.items,
    constraints: constraints.items,
    policyRef: policyRef.text,
    repository,
    worktreePath,
    status,
    statusProvenance: prov.provenance,
    nextAction: next.action,
    checkpointRef: safeId(input.checkpointRef),
    milestones,
    workItems,
    dependencies,
    budgets,
    budgetReceipt: isObject(input.budgetReceipt)
      ? {
          version: 1,
          granted: sanitizeBudgetLimits(
            (input.budgetReceipt as { granted?: unknown }).granted
          ),
          consumed: sanitizeBudgetLimits(
            (input.budgetReceipt as { consumed?: unknown }).consumed
          ),
          remaining: sanitizeBudgetLimits(
            (input.budgetReceipt as { remaining?: unknown }).remaining
          ),
          exhausted: Array.isArray((input.budgetReceipt as { exhausted?: unknown }).exhausted)
            ? ((input.budgetReceipt as { exhausted: string[] }).exhausted.filter((d) =>
                ["time", "tokens", "tools", "retries"].includes(d)
              ) as BudgetReceiptExhausted)
            : [],
          at: finiteTime((input.budgetReceipt as { at?: unknown }).at) ?? updatedAt,
        }
      : undefined,
    authority: authority.receipt,
    createdAt,
    updatedAt,
    importMeta,
  };

  return { ok: true, mission, redactions };
}

type BudgetReceiptExhausted = Array<"time" | "tokens" | "tools" | "retries">;

/**
 * Build a new mission from create input (assigns defaults).
 */
export function buildMissionFromCreate(
  input: MissionCreateInput,
  now = Date.now()
): MissionValidateResult {
  const id =
    input.id && MISSION_SAFE_ID.test(input.id.trim())
      ? input.id.trim()
      : `msn_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  return sanitizeMission(
    {
      version: 1,
      id,
      projectId: input.projectId,
      outcome: input.outcome,
      definitionOfDone: input.definitionOfDone ?? [],
      constraints: input.constraints ?? [],
      policyRef: input.policyRef,
      repository: input.repository,
      worktreePath: input.worktreePath,
      status: "draft",
      statusProvenance: {
        at: now,
        source: "user",
        reason: "Mission created",
      },
      nextAction: input.nextAction ?? {
        kind: "plan",
        label: "Define milestones and work items",
      },
      milestones: input.milestones ?? [],
      workItems: input.workItems ?? [],
      dependencies: input.dependencies ?? [],
      budgets: input.budgets ?? {},
      authority: input.authority
        ? {
            version: 1,
            policyRef: input.authority.policyRef,
            capabilities: input.authority.capabilities ?? [],
            repository: input.authority.repository || input.repository,
            worktreePath: input.authority.worktreePath,
            grantedAt: input.authority.grantedAt ?? now,
            authorityNeutralRestore: true,
          }
        : undefined,
      createdAt: now,
      updatedAt: now,
    },
    now
  );
}

/**
 * Mark restore/import path as authority-neutral (does not grant trust).
 */
export function markAuthorityNeutralImport(
  mission: Mission,
  source?: string,
  now = Date.now()
): Mission {
  return {
    ...mission,
    importMeta: {
      importedAt: now,
      source,
      authorityNeutral: true,
    },
    statusProvenance: {
      ...mission.statusProvenance,
      source: "import",
      reason: mission.statusProvenance.reason || "Imported mission (authority-neutral)",
    },
    authority: mission.authority
      ? { ...mission.authority, authorityNeutralRestore: true }
      : mission.authority,
    updatedAt: now,
  };
}
