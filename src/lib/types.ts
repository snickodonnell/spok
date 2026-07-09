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
  timestamp: number;
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
  tokensEstimate?: number;
}

export interface SessionConfig {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoScroll: boolean;
  playbackSpeed: number;
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
  source: "live" | "import" | "sample" | "paste" | "playback";
  /** Prompt / slash history for workspace composer */
  promptHistory: PromptTurn[];
  /** Sticky Grok CLI flags (serialized plain object) */
  grokFlags?: Record<string, unknown>;
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
  | "raw";

export interface StreamEvent {
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
}

export interface ExportPayload {
  version: 1;
  exportedAt: number;
  session: Session;
}

export type ViewMode = "workspace" | "unified" | "trace" | "diff" | "log" | "overview";

export type TraceFilter = {
  search: string;
  types: TraceNodeType[];
  status: Array<NonNullable<TraceNode["status"]>>;
  showOnlyLinked: boolean;
};
