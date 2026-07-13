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
