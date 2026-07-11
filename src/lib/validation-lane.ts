/**
 * Validation lane — pure derivation of commands, tools, tests, builds,
 * approvals, policy denials, and errors from session state.
 *
 * Roadmap: P0 “Stabilize The Review Loop” / Horizon 1 validation surface.
 * State is derived from nodes + eventLog so import/export/replay stay accurate
 * without a separate durable store.
 */

import type { Session, TraceNode, StreamEvent } from "./types";

export type ValidationKind =
  | "run"
  | "tool"
  | "test"
  | "build"
  | "command"
  | "approval"
  | "policy"
  | "error"
  | "parser"
  | "retry";

export type ValidationStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "blocked";

export type ValidationSeverity = "info" | "ok" | "warn" | "error";

export interface ValidationItem {
  id: string;
  kind: ValidationKind;
  status: ValidationStatus;
  severity: ValidationSeverity;
  title: string;
  detail: string;
  timestamp: number;
  durationMs?: number;
  /** Process / tool exit when known. */
  exitCode?: number | null;
  command?: string;
  toolName?: string;
  /** Trace node for left-pane navigation. */
  traceNodeId?: string;
  /** Stream event id when distinct from the node. */
  eventId?: string;
  /** FileDiff ids linked via trace. */
  fileIds: string[];
  /** Repo-relative paths for display. */
  paths: string[];
  /** Groups retries of the same logical action. */
  groupKey?: string;
  /** Attempt index when this item is a retry (1 = first try). */
  attempt?: number;
}

export interface ValidationLaneSummary {
  total: number;
  running: number;
  failed: number;
  blocked: number;
  success: number;
  pending: number;
  /** Highest-priority headline for status chrome. */
  headline: string;
  /** True when any failed/blocked item is open. */
  needsAttention: boolean;
}

export interface ValidationLane {
  items: ValidationItem[];
  summary: ValidationLaneSummary;
}

const TEST_TOOL_RE =
  /\b(test|tests|jest|vitest|mocha|pytest|phpunit|cargo\s+test|go\s+test|npm\s+test|pnpm\s+test|yarn\s+test|npx\s+.*test)\b/i;
const BUILD_TOOL_RE =
  /\b(build|compile|tsc|webpack|esbuild|rollup|cargo\s+build|go\s+build|npm\s+run\s+build|pnpm\s+build|yarn\s+build|make\b|cmake)\b/i;

function nodeStatusToValidation(
  status: TraceNode["status"] | undefined
): ValidationStatus {
  switch (status) {
    case "running":
    case "pending":
      return status;
    case "error":
      return "failed";
    case "skipped":
      return "skipped";
    case "success":
      return "success";
    default:
      return "pending";
  }
}

function statusSeverity(status: ValidationStatus): ValidationSeverity {
  switch (status) {
    case "failed":
    case "blocked":
      return "error";
    case "running":
    case "pending":
      return "warn";
    case "skipped":
      return "info";
    case "success":
      return "ok";
  }
}

function classifyToolKind(
  toolName: string | undefined,
  title: string,
  content: string
): ValidationKind {
  const blob = `${toolName ?? ""} ${title} ${content}`;
  if (TEST_TOOL_RE.test(blob)) return "test";
  if (BUILD_TOOL_RE.test(blob)) return "build";
  return "tool";
}

function pathsFromNode(
  node: TraceNode,
  session: Session
): { fileIds: string[]; paths: string[] } {
  const fileIds: string[] = [];
  const paths: string[] = [];
  for (const link of node.links) {
    if (link.kind !== "file") continue;
    if (link.targetId && session.files[link.targetId]) {
      fileIds.push(link.targetId);
      paths.push(session.files[link.targetId].path);
    } else if (link.path) {
      paths.push(link.path);
    }
  }
  if (typeof node.meta?.path === "string" && node.meta.path) {
    paths.push(node.meta.path);
  }
  return {
    fileIds: [...new Set(fileIds)],
    paths: [...new Set(paths)],
  };
}

function firstLine(text: string | undefined, max = 160): string {
  if (!text) return "";
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function extractExitCode(
  content: string | undefined,
  meta: Record<string, unknown> | undefined
): number | null | undefined {
  if (meta) {
    const c = meta.code ?? meta.exitCode ?? meta.exit_code;
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && /^-?\d+$/.test(c)) return Number(c);
  }
  if (!content) return undefined;
  const m =
    content.match(/\bexit(?:\s+code)?[:\s]+(-?\d+)\b/i) ||
    content.match(/\bcode\s*[:=]\s*(-?\d+)\b/i);
  if (m) return Number(m[1]);
  return undefined;
}

function itemFromToolNode(node: TraceNode, session: Session): ValidationItem {
  const kind = classifyToolKind(node.toolName, node.title, node.content || "");
  const status = nodeStatusToValidation(node.status);
  const { fileIds, paths } = pathsFromNode(node, session);
  const exitCode = extractExitCode(node.content, node.meta);
  const toolName = node.toolName || node.title;
  return {
    id: `tool:${node.id}`,
    kind,
    status,
    severity: statusSeverity(status),
    title:
      kind === "test"
        ? `Test · ${toolName}`
        : kind === "build"
          ? `Build · ${toolName}`
          : `Tool · ${toolName}`,
    detail:
      firstLine(node.summary) ||
      firstLine(node.content) ||
      (status === "running" ? "In progress" : status),
    timestamp: node.timestamp,
    durationMs: node.durationMs,
    exitCode: exitCode ?? (status === "failed" ? 1 : status === "success" ? 0 : undefined),
    toolName,
    command: typeof node.meta?.command === "string" ? node.meta.command : undefined,
    traceNodeId: node.id,
    eventId: node.id,
    fileIds,
    paths,
    groupKey: `tool:${(node.toolName || node.title).toLowerCase()}`,
  };
}

function itemFromSystemishNode(
  node: TraceNode,
  session: Session
): ValidationItem | null {
  const meta = node.meta ?? {};
  const auditType = meta.auditType as string | undefined;
  const titleLower = (node.title || "").toLowerCase();
  const content = node.content || "";
  const { fileIds, paths } = pathsFromNode(node, session);

  if (
    auditType === "approval_request" ||
    titleLower.includes("approval required")
  ) {
    return {
      id: `approval-req:${node.id}`,
      kind: "approval",
      status: "blocked",
      severity: "warn",
      title: "Approval required",
      detail: firstLine(content) || "Waiting for user decision",
      timestamp: node.timestamp,
      traceNodeId: node.id,
      eventId: node.id,
      fileIds,
      paths,
      groupKey: "approval",
    };
  }

  if (
    auditType === "approval_decision" ||
    titleLower.startsWith("approval ")
  ) {
    const denied =
      node.status === "skipped" ||
      /deny|denied/i.test(content) ||
      meta.decision === "deny";
    return {
      id: `approval-dec:${node.id}`,
      kind: "approval",
      status: denied ? "blocked" : "success",
      severity: denied ? "error" : "ok",
      title: denied ? "Approval denied" : "Approval granted",
      detail: firstLine(content) || String(meta.decision ?? node.status),
      timestamp: node.timestamp,
      traceNodeId: node.id,
      eventId: node.id,
      fileIds,
      paths,
      groupKey: "approval",
    };
  }

  if (
    auditType === "policy_denial" ||
    node.meta?.severity === "policy" ||
    titleLower.includes("policy denial") ||
    titleLower.includes("workspace not trusted") ||
    titleLower.includes("command not allowed")
  ) {
    return {
      id: `policy:${node.id}`,
      kind: "policy",
      status: "blocked",
      severity: "error",
      title: node.title || "Policy denial",
      detail: firstLine(content) || "Action blocked by policy",
      timestamp: node.timestamp,
      command: typeof meta.command === "string" ? meta.command : undefined,
      traceNodeId: node.id,
      eventId: node.id,
      fileIds,
      paths,
      groupKey: "policy",
    };
  }

  if (node.type === "error" || node.status === "error") {
    const kind: ValidationKind =
      node.meta?.severity === "parser" ||
      titleLower.includes("parser") ||
      /parser/i.test(content)
        ? "parser"
        : "error";
    return {
      id: `err:${node.id}`,
      kind,
      status: "failed",
      severity: "error",
      title: node.title || (kind === "parser" ? "Parser warning" : "Error"),
      detail: firstLine(content) || "Failed",
      timestamp: node.timestamp,
      exitCode: extractExitCode(content, meta) ?? 1,
      traceNodeId: node.id,
      eventId: node.id,
      fileIds,
      paths,
      groupKey: kind,
    };
  }

  // Harness “Run” / shell-style system lines
  if (node.type === "system") {
    const isRun =
      titleLower === "run" ||
      content.trimStart().startsWith("$ ") ||
      titleLower.includes("launch");
    const isStop =
      titleLower.includes("stopped") || titleLower.includes("cancelled");
    const isExit =
      /exit code/i.test(content) ||
      titleLower.includes("stream error") ||
      titleLower.includes("launch failed");

    if (isRun || isStop || isExit) {
      let status: ValidationStatus = nodeStatusToValidation(node.status);
      if (isStop) status = "skipped";
      if (
        isExit &&
        (String(node.status) === "error" || /fail|error/i.test(titleLower))
      ) {
        status = "failed";
      }
      const exitCode = extractExitCode(content, meta);
      if (exitCode != null && exitCode !== 0) status = "failed";
      if (exitCode === 0) status = "success";

      const cmdMatch = content.match(/^\$\s+(.+)$/m);
      return {
        id: `run:${node.id}`,
        kind: "run",
        status,
        severity: statusSeverity(status),
        title: isStop ? "Run stopped" : isExit ? "Run result" : "Run",
        detail: firstLine(content) || node.title,
        timestamp: node.timestamp,
        durationMs: node.durationMs,
        exitCode,
        command: cmdMatch?.[1],
        traceNodeId: node.id,
        eventId: node.id,
        fileIds,
        paths,
        groupKey: "run",
      };
    }
  }

  return null;
}

function itemsFromEventLog(session: Session, seenIds: Set<string>): ValidationItem[] {
  const events = session.eventLog ?? [];
  const out: ValidationItem[] = [];

  for (const ev of events) {
    if (!ev.id || seenIds.has(ev.id)) continue;
    // Prefer nodes; only surface system/error stream events not already nodes
    if (ev.type !== "system" && ev.type !== "error" && ev.type !== "parser_error") {
      continue;
    }
    if (session.nodes[ev.id]) continue;

    const synthetic: TraceNode = {
      id: ev.id,
      parentId: ev.parentId ?? null,
      type: ev.type === "system" ? "system" : "error",
      title: ev.title || ev.type,
      content: ev.content || "",
      summary: ev.summary,
      timestamp: ev.timestamp,
      durationMs: ev.durationMs,
      status: ev.status,
      children: [],
      links: ev.links ?? [],
      depth: 0,
      toolName: ev.toolName,
      meta: {
        ...ev.meta,
        severity: ev.severity,
      },
    };
    const item = itemFromSystemishNode(synthetic, session);
    if (item) {
      seenIds.add(ev.id);
      out.push(item);
    }
  }

  return out;
}

function annotateRetries(items: ValidationItem[]): ValidationItem[] {
  const byGroup = new Map<string, ValidationItem[]>();
  for (const item of items) {
    const key = item.groupKey ?? item.id;
    const list = byGroup.get(key) ?? [];
    list.push(item);
    byGroup.set(key, list);
  }

  const retries: ValidationItem[] = [];
  for (const group of byGroup.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach((item, i) => {
      item.attempt = i + 1;
      if (i > 0) {
        // Mark later attempts as retries for filtering / badge
        if (item.kind === "tool" || item.kind === "test" || item.kind === "build") {
          // keep kind; add retry marker via attempt only
        }
      }
    });
    // If a later attempt succeeded after failure, keep both (history)
    void retries;
  }
  return items;
}

export function summarizeValidationItems(
  items: ValidationItem[]
): ValidationLaneSummary {
  let running = 0;
  let failed = 0;
  let blocked = 0;
  let success = 0;
  let pending = 0;
  for (const i of items) {
    switch (i.status) {
      case "running":
        running++;
        break;
      case "failed":
        failed++;
        break;
      case "blocked":
        blocked++;
        break;
      case "success":
        success++;
        break;
      case "pending":
        pending++;
        break;
      default:
        break;
    }
  }

  const needsAttention = failed > 0 || blocked > 0;
  let headline = "No validation activity";
  if (items.length === 0) {
    headline = "No validation activity yet";
  } else if (running > 0) {
    headline = `${running} running`;
  } else if (blocked > 0) {
    headline = `${blocked} need approval / blocked`;
  } else if (failed > 0) {
    headline = `${failed} failed`;
  } else if (success > 0) {
    headline = `${success} passed`;
  } else if (pending > 0) {
    headline = `${pending} pending`;
  }

  return {
    total: items.length,
    running,
    failed,
    blocked,
    success,
    pending,
    headline,
    needsAttention,
  };
}

/**
 * Build the validation lane for a session (chronological ascending).
 */
export function buildValidationLane(session: Session): ValidationLane {
  const items: ValidationItem[] = [];
  const seenIds = new Set<string>();

  const nodes = Object.values(session.nodes).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  for (const node of nodes) {
    if (node.type === "tool_call") {
      items.push(itemFromToolNode(node, session));
      seenIds.add(node.id);
      continue;
    }
    // tool_result nodes are folded into tool_call in the live store; skip standalone noise
    if (node.type === "tool_result") continue;

    const sys = itemFromSystemishNode(node, session);
    if (sys) {
      items.push(sys);
      seenIds.add(node.id);
    }
  }

  items.push(...itemsFromEventLog(session, seenIds));

  // Session-level run outcome if no explicit exit event
  if (
    (session.status === "error" || session.status === "completed" || session.status === "stopped") &&
    !items.some((i) => i.kind === "run" && i.status !== "running")
  ) {
    const status: ValidationStatus =
      session.status === "completed"
        ? "success"
        : session.status === "stopped"
          ? "skipped"
          : "failed";
    items.push({
      id: `session-outcome:${session.id}`,
      kind: "run",
      status,
      severity: statusSeverity(status),
      title:
        session.status === "completed"
          ? "Session completed"
          : session.status === "stopped"
            ? "Session stopped"
            : "Session failed",
      detail: session.error || session.status,
      timestamp: session.metrics.endedAt ?? session.updatedAt,
      durationMs: session.metrics.elapsedMs,
      fileIds: [],
      paths: [],
      groupKey: "run",
    });
  }

  annotateRetries(items);
  items.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  return {
    items,
    summary: summarizeValidationItems(items),
  };
}

export type ValidationFilter =
  | "all"
  | "failures"
  | "running"
  | "attention"
  | "tests"
  | "approvals";

export function filterValidationItems(
  items: ValidationItem[],
  filter: ValidationFilter
): ValidationItem[] {
  switch (filter) {
    case "failures":
      return items.filter((i) => i.status === "failed" || i.status === "blocked");
    case "running":
      return items.filter((i) => i.status === "running" || i.status === "pending");
    case "attention":
      return items.filter(
        (i) =>
          i.status === "failed" ||
          i.status === "blocked" ||
          i.status === "running"
      );
    case "tests":
      return items.filter((i) => i.kind === "test" || i.kind === "build");
    case "approvals":
      return items.filter((i) => i.kind === "approval" || i.kind === "policy");
    default:
      return items;
  }
}

/** Compact badge count for the workspace tab (failed + blocked + running). */
export function validationTabBadge(summary: ValidationLaneSummary): number {
  return summary.failed + summary.blocked + summary.running;
}
