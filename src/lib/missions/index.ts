/**
 * Mission v1 public surface — types, validation, budgets, checkpoints, persistence.
 */

export {
  MISSION_SCHEMA_VERSION,
  MISSION_SAFE_ID,
  type AuthorityReceipt,
  type BudgetDimension,
  type BudgetLimits,
  type BudgetReceipt,
  type DependencyEdge,
  type Milestone,
  type MilestoneStatus,
  type Mission,
  type MissionCheckpoint,
  type MissionCreateInput,
  type MissionDomainErrorCode,
  type MissionMeta,
  type MissionNextAction,
  type MissionSchemaVersion,
  type MissionStatus,
  type ProcessExitProvenance,
  type StatusProvenance,
  type StatusSource,
  type TerminalOutcomeKind,
  type TerminalOutcomeProvenance,
  type WorkItem,
  type WorkItemStatus,
} from "./types";

export {
  applyBudgetConsumption,
  assertWorkItemBudgetWithinMission,
  buildBudgetReceipt,
  childWithinParent,
  sanitizeBudgetLimits,
  type BudgetCheckResult,
} from "./budgets";

export {
  checkpointFromJSON,
  checkpointToJSON,
  materializeCheckpoint,
  type CheckpointMaterializeInput,
} from "./checkpoint";

export {
  assertAuthorityWithinParent,
  assertDependencySatisfaction,
  assertRequestedCapabilityAllowed,
  assertRetryAllowed,
  assertWorkItemCompletion,
  buildMissionFromCreate,
  markAuthorityNeutralImport,
  sanitizeMission,
  type DomainOpResult,
  type MissionValidateResult,
} from "./validate";

export {
  checkpointMission,
  createMission,
  getMissionDir,
  getMissionsRoot,
  importMission,
  listCheckpointIds,
  listMissions,
  readCheckpoint,
  readMission,
  saveCheckpoint,
  toMissionMeta,
  writeMission,
  type PersistResult,
} from "./persist";

export {
  MISSION_RECEIPT_VERSION,
  MIN_INTEGRATION_RESERVE_RATIO,
  MissionReceiptError,
  compileMissionReceiptBundle,
  migrateMissionReceiptBundle,
  readMissionReceiptBundle,
  saveMissionReceiptBundle,
  type MissionReceipt,
  type MissionReceiptBundle,
  type MissionReceiptDraft,
  type WorkItemReceipt,
} from "./receipts";

export {
  MISSION_SCHEDULER_VERSION,
  missionScheduleInputSchema,
  parseMissionScheduleInput,
  scheduleMissionReceipts,
  type ApprovalState,
  type MissionSchedule,
  type MissionScheduleInput,
  type ProviderLaneEvidence,
  type ScheduleReason,
  type WorkItemScheduleDecision,
} from "./scheduler";
