/**
 * Automation & parallel-agent contracts (Phase 5).
 *
 * Background queue, schedules, channels/webhooks, notifications, subagent lanes.
 */

export type JobKind = "background" | "scheduled" | "channel" | "compare";

export type QueueItemStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

/** A single background / scheduled / channel-triggered job. */
export interface AutomationJob {
  id: string;
  kind: JobKind;
  /** Human label for Monitor cards */
  title: string;
  prompt: string;
  cwd: string;
  /** Prefer isolated worktree for the run */
  isolate: boolean;
  /** Optional Spok-managed worktree path once created */
  worktreePath?: string;
  mainCheckout?: string;
  status: QueueItemStatus;
  priority: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Session created for this job */
  sessionId?: string;
  /** Parent / origin session (subagent lane or channel target) */
  parentSessionId?: string;
  scheduleId?: string;
  channelId?: string;
  error?: string;
  /** Exit code from harness when known */
  exitCode?: number | null;
  /** Agent preset id from extensions */
  agentId?: string;
  /** Compact result summary for Monitor */
  summary?: string;
}

export type ScheduleIntervalUnit = "minutes" | "hours" | "days";

export interface ScheduleDefinition {
  id: string;
  name: string;
  enabled: boolean;
  cwd: string;
  prompt: string;
  /** Every N units */
  every: number;
  unit: ScheduleIntervalUnit;
  /** Require trusted workspace (default true) */
  requireTrusted: boolean;
  /** Run in isolated worktree (default true for safety) */
  isolate: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  lastJobId?: string;
  lastStatus?: QueueItemStatus;
  /** Optional note shown in UI */
  description?: string;
}

export type ChannelTargetMode =
  | "queue_background"
  | "new_session"
  | "notify_only";

export interface ChannelDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Shared secret required on ingest (header x-spok-channel-secret) */
  secret: string;
  cwd: string;
  targetMode: ChannelTargetMode;
  /** Default prompt template; {{payload}} and {{title}} supported */
  promptTemplate: string;
  isolate: boolean;
  requireTrusted: boolean;
  createdAt: number;
  updatedAt: number;
  lastEventAt?: number;
  eventCount: number;
}

export interface ChannelEventRecord {
  id: string;
  channelId: string;
  receivedAt: number;
  title?: string;
  payload: string;
  jobId?: string;
  status: "accepted" | "rejected" | "queued";
  reason?: string;
}

export type NotificationKind =
  | "run_complete"
  | "run_failed"
  | "run_cancelled"
  | "approval_needed"
  | "schedule_fired"
  | "schedule_skipped"
  | "channel_event"
  | "subagent_complete"
  | "info";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  sessionId?: string;
  jobId?: string;
  scheduleId?: string;
  channelId?: string;
  /** Deep-link action for UI */
  action?: "open_session" | "open_monitor" | "open_approvals";
}

export type SubagentLaneStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "skipped";

/** One parallel subagent lane within a session (or child session). */
export interface SubagentLane {
  id: string;
  label: string;
  status: SubagentLaneStatus;
  startedAt: number;
  endedAt?: number;
  /** Trace node ids belonging to this lane */
  nodeIds: string[];
  /** Short merged summary text */
  summary?: string;
  toolCallCount: number;
  errorCount: number;
  /** When lane maps to a child session */
  childSessionId?: string;
}

export interface AutomationBundle {
  schedules: ScheduleDefinition[];
  channels: ChannelDefinition[];
  recentChannelEvents: ChannelEventRecord[];
  /** Server-side policy notes */
  policy: {
    requireTrustedDefault: boolean;
    maxConcurrentBackground: number;
    maxSchedules: number;
  };
}

export const AUTOMATION_DEFAULTS = {
  maxConcurrentBackground: 2,
  maxSchedules: 50,
  maxChannels: 20,
  maxQueueHistory: 100,
  maxNotifications: 80,
  maxChannelEvents: 50,
  scheduleTickMs: 30_000,
} as const;

export function intervalToMs(every: number, unit: ScheduleIntervalUnit): number {
  const n = Math.max(1, Math.floor(every));
  if (unit === "minutes") return n * 60_000;
  if (unit === "hours") return n * 3_600_000;
  return n * 86_400_000;
}

export function computeNextRunAt(
  from: number,
  every: number,
  unit: ScheduleIntervalUnit
): number {
  return from + intervalToMs(every, unit);
}
