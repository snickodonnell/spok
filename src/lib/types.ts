/** Core domain types for Spok live harness */

export type SessionStatus =
  | "idle"
  | "ready"
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "error"
  | "stopped";

export type TraceNodeType =
  | "session"
  | "thinking"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "plan"
  | "plan_update"
  | "subagent"
  | "decision"
  | "message"
  | "error"
  | "system"
  | "file_change"
  | "goal"
  | "branch";

export type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";

export type LinkKind = "file" | "hunk" | "tool" | "subagent" | "plan";

export interface TraceLink {
  kind: LinkKind;
  targetId: string;
  label?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface TraceNode {
  id: string;
  parentId: string | null;
  type: TraceNodeType;
  title: string;
  content: string;
  summary?: string;
  timestamp: number;
  durationMs?: number;
  status?: "pending" | "running" | "success" | "error" | "skipped";
  children: string[];
  links: TraceLink[];
  meta?: Record<string, unknown>;
  /** Depth in tree for layout */
  depth: number;
  /** Tool name if tool_call */
  toolName?: string;
  /** Subagent id if subagent */
  subagentId?: string;
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiff {
  id: string;
  path: string;
  oldPath?: string;
  status: DiffStatus;
  language: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  oldContent?: string;
  newContent?: string;
  /** Trace node ids that produced this change */
  relatedTraceIds: string[];
  isBinary?: boolean;
  /** Secret path denied from content preview */
  isSecret?: boolean;
  /** Staging areas from git status (Phase 3). */
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  conflict?: boolean;
  timestamp: number;
}

/** Inline review comment linked to a path / optional trace node (Phase 3). */
export interface ReviewComment {
  id: string;
  path: string;
  line?: number;
  hunkId?: string;
  traceNodeId?: string;
  body: string;
  author: "user" | "agent" | "system";
  createdAt: number;
  resolved?: boolean;
}

/** Lightweight branch/worktree snapshot cached on the session. */
export interface SessionGitSummary {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
  clean: boolean;
  isWorktree: boolean;
  mainWorktreePath: string | null;
  repoRoot: string | null;
  headOid: string | null;
  updatedAt: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  status?: DiffStatus;
  children?: FileTreeNode[];
  additions?: number;
  deletions?: number;
  fileId?: string;
}

export interface SessionMetrics {
  startedAt: number | null;
  endedAt: number | null;
  elapsedMs: number;
  toolCallCount: number;
  thinkingSteps: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  subagentCount: number;
  errorCount: number;
  /** Best-known token total (provider-reported or estimated). */
  tokensEstimate?: number;
  /** Context window budget for usage UI (tokens). */
  tokensLimit?: number;
}

export interface SessionConfig {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoScroll: boolean;
  playbackSpeed: number;
  /**
   * When set, this session is bound to a Spok-managed worktree and must not
   * mutate the main checkout (isolation guard).
   */
  worktreePath?: string;
  /** Main repo checkout when running inside an isolated worktree. */
  mainCheckout?: string;
  /** Isolation enabled for background / worktree sessions. */
  isolationGuard?: boolean;
}

export interface PromptTurn {
  id: string;
  text: string;
  label: string;
  timestamp: number;
  status: "pending" | "running" | "success" | "error" | "cancelled";
}

export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  config: SessionConfig;
  metrics: SessionMetrics;
  /** Root trace node ids */
  rootTraceIds: string[];
  nodes: Record<string, TraceNode>;
  files: Record<string, FileDiff>;
  fileTree: FileTreeNode[];
  selectedTraceId: string | null;
  selectedFileId: string | null;
  timelineCursor: number | null;
  rawLog: string[];
  error?: string;
  source: "live" | "import" | "sample" | "paste" | "playback" | "resume";
  /** Prompt / slash history for workspace composer */
  promptHistory: PromptTurn[];
  /** Sticky Grok CLI flags (serialized plain object) */
  grokFlags?: Record<string, unknown>;
  /**
   * In-memory normalized event log for export/replay.
   * Durable copy also lives under ~/.spok/sessions/<id>/events.ndjson.
   */
  eventLog?: StreamEvent[];
  /** Whether this session is persisted on disk */
  durable?: boolean;
  /** Last durable flush timestamp */
  lastPersistedAt?: number;
  /** Count of normalized events written (disk or memory) */
  eventCount?: number;
  /** Cached git branch/status summary for status line + Git panel. */
  gitSummary?: SessionGitSummary;
  /** Review-mode comments for this session. */
  reviewComments?: ReviewComment[];
  /** When true, review pane is emphasized in the Git panel. */
  reviewMode?: boolean;
  /**
   * Subagent lanes extracted for parallel-agent UX (Phase 5).
   * Kept on the session so lanes survive focus switches.
   */
  subagentLanes?: import("./automation/types").SubagentLane[];
  /** True when this session was created for a background/scheduled job. */
  backgroundJob?: boolean;
}

export interface SampleSessionMeta {
  id: string;
  name: string;
  description: string;
  duration: string;
  filesChanged: number;
  toolCalls: number;
  tags: string[];
}

/** NDJSON / stream event from harness */
export type StreamEventType =
  | "session_start"
  | "session_end"
  | "thinking"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "plan"
  | "plan_update"
  | "subagent_start"
  | "subagent_end"
  | "message"
  | "file_change"
  | "diff"
  | "error"
  | "system"
  | "goal"
  | "raw"
  | "parser_error";

export type StreamEventProvider =
  | "grok"
  | "spok"
  | "import"
  | "harness"
  | "unknown";

export type StreamEventSeverity =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "parser"
  | "runtime"
  | "policy";

export interface StreamEvent {
  /** Schema version; omit only on legacy imports (migrated on load). */
  version?: number;
  type: StreamEventType;
  timestamp: number;
  sessionId?: string;
  id?: string;
  parentId?: string | null;
  title?: string;
  content?: string;
  summary?: string;
  toolName?: string;
  status?: TraceNode["status"];
  path?: string;
  oldPath?: string;
  diffStatus?: DiffStatus;
  oldContent?: string;
  newContent?: string;
  language?: string;
  meta?: Record<string, unknown>;
  links?: TraceLink[];
  subagentId?: string;
  durationMs?: number;
  /** Origin of the event (provider adapter or harness). */
  provider?: StreamEventProvider;
  /** Pointer into append-only raw log when available. */
  rawEventId?: string;
  /** Process / harness run identity. */
  runId?: string;
  /** User prompt turn identity. */
  turnId?: string;
  severity?: StreamEventSeverity;
  /** Count of secret redactions applied to this event. */
  redactions?: number;
}

/** Legacy v1 export: snapshot only. */
export interface ExportPayloadV1 {
  version: 1;
  exportedAt: number;
  session: Session;
}

/**
 * v2 export: snapshot + ordered event log for faithful replay.
 * Importers should prefer `events` when present.
 */
export interface ExportPayloadV2 {
  version: 2;
  exportedAt: number;
  session: Session;
  events: StreamEvent[];
  /** Optional raw line log for debugging */
  rawLog?: string[];
}

export type ExportPayload = ExportPayloadV1 | ExportPayloadV2;

/** On-disk session index entry (also returned by /api/sessions). */
export type SessionMetaRecord = {
  id: string;
  name: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  source: Session["source"];
  cwd: string;
  command: string;
  eventCount: number;
  rawCount: number;
  pinned?: boolean;
  formatVersion: number;
  grokFlags?: Record<string, unknown>;
  error?: string;
};

export type ViewMode = "workspace" | "unified" | "trace" | "diff" | "log" | "overview";

/** Primary product modes — see `src/lib/product-modes.ts`. */
export type ProductMode = import("./product-modes").ProductMode;
export type WorkspaceRightTab = import("./product-modes").WorkspaceRightTab;
export type LeftTraceMode = import("./product-modes").LeftTraceMode;

export type TraceFilter = {
  search: string;
  types: TraceNodeType[];
  status: Array<NonNullable<TraceNode["status"]>>;
  showOnlyLinked: boolean;
};
