/**
 * Shared Spok privileged runtime handlers (Track A).
 * Next App Router re-exports these; standalone main.ts will mount them too.
 */

export {
  handleSessionStartGet,
  handleSessionStartPost,
  handleSessionStartDelete,
} from "./routes/session-start";
export { handleHealthGet } from "./routes/health";
export { handleFsBrowseGet } from "./routes/fs-browse";
export {
  handleTrustGet,
  handleTrustPost,
  handleTrustDelete,
} from "./routes/workspace-trust";
export { handleGitGet, handleGitPost } from "./routes/session-git";
export { handleGitDiffGet } from "./routes/session-git-diff";
export {
  handleSessionsListGet,
  handleSessionsListPost,
} from "./routes/sessions-list";
export {
  handleSessionIdGet,
  handleSessionIdPut,
  handleSessionIdDelete,
} from "./routes/sessions-id";
export {
  handleSessionEventsGet,
  handleSessionEventsPost,
} from "./routes/sessions-events";
export { handleSettingsGet, handleSettingsPut } from "./routes/settings";
export {
  handleApprovalsGet,
  handleApprovalsPost,
  handleApprovalsDelete,
} from "./routes/approvals";
export { handleDiagnosticsGet } from "./routes/diagnostics";
export { handleCliStatusGet } from "./routes/cli-status";
export {
  handleAutomationJobsGet,
  handleAutomationJobsPost,
  handleAutomationJobsPut,
} from "./routes/automation-jobs";
export {
  handleMissionsGet,
  handleMissionsPost,
  handleMissionIdGet,
  handleMissionIdPut,
  handleMissionCheckpointGet,
  handleMissionCheckpointPost,
} from "./routes/missions";
export {
  handleMissionReceiptsGet,
  handleMissionReceiptsPost,
  handleMissionSchedulePost,
} from "./routes/mission-orchestration";
