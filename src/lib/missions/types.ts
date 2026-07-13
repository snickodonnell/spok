/**
 * Mission v1 domain contract (P1 roadmap items 1–2, UX-013 foundation).
 *
 * Spok owns plan/dependency truth. Agents never become product truth.
 * Hierarchy: Project → Mission → Milestone → WorkItem → Agent run → Evidence.
 * Process exit is not review readiness; restore/import is authority-neutral.
 */

export const MISSION_SCHEMA_VERSION = 1 as const;

export type MissionSchemaVersion = typeof MISSION_SCHEMA_VERSION;

/** Safe id: alphanumeric start, then alnum / . _ - (max 128). */
export const MISSION_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type MissionStatus =
  | "draft"
  | "active"
  | "blocked"
  | "review_ready"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived";

export type MilestoneStatus =
  | "pending"
  | "active"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkItemStatus =
  | "pending"
  | "ready"
  | "active"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type StatusSource = "user" | "spok" | "system" | "import" | "restore";

export type StatusProvenance = {
  at: number;
  source: StatusSource;
  reason: string;
};

/**
 * Process exit provenance — supporting signal only.
 * Never alone sufficient to complete a dependency or mark review-ready.
 */
export type ProcessExitProvenance = {
  kind: "process_exit";
  exitCode: number | null;
  at: number;
  sessionId?: string;
  jobId?: string;
  signal?: string;
};

/**
 * Terminal outcome for a work item / milestone / mission.
 * Distinct from process exit; requires explicit outcome + reason.
 */
export type TerminalOutcomeKind =
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "superseded";

export type TerminalOutcomeProvenance = {
  kind: "terminal_outcome";
  outcome: TerminalOutcomeKind;
  at: number;
  reason: string;
  /** Evidence that justified this terminal claim (required for completed). */
  evidenceRefs: string[];
  /** Optional supporting process exit — never sufficient alone. */
  processExit?: ProcessExitProvenance;
};

/** Time / token / tool / retry budget caps. */
export type BudgetLimits = {
  timeMs?: number;
  tokens?: number;
  toolCalls?: number;
  retries?: number;
};

export type BudgetDimension = "time" | "tokens" | "tools" | "retries";

/** Versioned receipt of granted vs consumed budget. */
export type BudgetReceipt = {
  version: 1;
  granted: BudgetLimits;
  consumed: BudgetLimits;
  remaining: BudgetLimits;
  exhausted: BudgetDimension[];
  at: number;
};

/**
 * Authority receipt for mission or work-item scope.
 * Child work items inherit no more than the mission receipt.
 */
export type AuthorityReceipt = {
  version: 1;
  policyRef: string;
  /** Capability ids granted at this scope (allowlist, not secrets). */
  capabilities: string[];
  /** Absolute repository / cwd path recorded for audit; does not grant trust. */
  repository: string;
  worktreePath?: string;
  grantedAt: number;
  /** Explicit marker that persisted receipts never auto-grant trust on restore. */
  authorityNeutralRestore: true;
};

export type MissionNextAction = {
  kind: string;
  label: string;
  workItemId?: string;
  milestoneId?: string;
};

export type Milestone = {
  id: string;
  title: string;
  exitCriteria: string[];
  status: MilestoneStatus;
  statusProvenance: StatusProvenance;
  /** Work-item or milestone ids that must complete with evidence. */
  dependencyRefs: string[];
  workItemIds: string[];
  terminalOutcome?: TerminalOutcomeProvenance;
};

export type WorkItem = {
  id: string;
  milestoneId?: string;
  title: string;
  /** Owner identity: "spok" or specialist / agent id. */
  owner: string;
  /** Upstream work-item ids. */
  dependencies: string[];
  requestedCapability: string;
  authorityReceipt?: AuthorityReceipt;
  budgets: BudgetLimits;
  budgetReceipt?: BudgetReceipt;
  expectedEvidence: string[];
  retries: { max: number; used: number };
  status: WorkItemStatus;
  statusProvenance: StatusProvenance;
  /** Distinct terminal claim — not process exit. */
  terminalOutcome?: TerminalOutcomeProvenance;
  /** Supporting process exit only. */
  processExit?: ProcessExitProvenance;
};

/**
 * Dependency edge that refuses false completion without evidence.
 * `requiresEvidence` is always true in v1.
 */
export type DependencyEdge = {
  id: string;
  from: string;
  to: string;
  requiresEvidence: true;
  evidenceRefs: string[];
  satisfied: boolean;
};

/**
 * Checkpoint projection for resumable missions without full transcript replay.
 * Materialize with pure functions under the 500ms budget.
 */
export type MissionCheckpoint = {
  version: 1;
  id: string;
  missionId: string;
  at: number;
  completed: string[];
  active: string[];
  blocked: Array<{ id: string; reason: string }>;
  changedAssumptions: string[];
  evidenceRefs: string[];
  risks: string[];
  nextDecisions: string[];
};

export type Mission = {
  version: MissionSchemaVersion;
  id: string;
  projectId?: string;
  outcome: string;
  definitionOfDone: string[];
  constraints: string[];
  policyRef: string;
  /** Absolute repository path (recorded; restore does not grant trust). */
  repository: string;
  worktreePath?: string;
  status: MissionStatus;
  statusProvenance: StatusProvenance;
  nextAction: MissionNextAction;
  checkpointRef?: string;
  milestones: Milestone[];
  workItems: WorkItem[];
  dependencies: DependencyEdge[];
  budgets: BudgetLimits;
  budgetReceipt?: BudgetReceipt;
  authority?: AuthorityReceipt;
  createdAt: number;
  updatedAt: number;
  /**
   * Present when the record was imported/restored.
   * Always authority-neutral: reading never grants trust or execution power.
   */
  importMeta?: {
    importedAt: number;
    source?: string;
    authorityNeutral: true;
  };
};

/** List projection — no nested work graph (bounded hot path). */
export type MissionMeta = {
  version: MissionSchemaVersion;
  id: string;
  projectId?: string;
  outcome: string;
  status: MissionStatus;
  statusReason: string;
  nextAction: MissionNextAction;
  repository: string;
  checkpointRef?: string;
  createdAt: number;
  updatedAt: number;
  milestoneCount: number;
  workItemCount: number;
};

export type MissionCreateInput = {
  id?: string;
  projectId?: string;
  outcome: string;
  definitionOfDone?: string[];
  constraints?: string[];
  policyRef: string;
  repository: string;
  worktreePath?: string;
  budgets?: BudgetLimits;
  authority?: Omit<AuthorityReceipt, "version" | "authorityNeutralRestore" | "grantedAt"> & {
    grantedAt?: number;
  };
  milestones?: Array<Partial<Milestone> & { id: string; title: string }>;
  workItems?: Array<
    Partial<WorkItem> & {
      id: string;
      title: string;
      owner: string;
      requestedCapability: string;
    }
  >;
  dependencies?: Array<Partial<DependencyEdge> & { id: string; from: string; to: string }>;
  nextAction?: MissionNextAction;
};

export type MissionDomainErrorCode =
  | "invalid_mission"
  | "invalid_id"
  | "invalid_status"
  | "invalid_dependency"
  | "missing_evidence"
  | "budget_exhausted"
  | "budget_over_parent"
  | "authority_over_request"
  | "retry_exhausted"
  | "not_found"
  | "conflict"
  | "invalid_json"
  | "forbidden";
