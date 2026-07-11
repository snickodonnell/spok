/**
 * Review queue: group changes by risk / intent for the Review workbench.
 * Pure derivation from session files + optional causal/validation signals.
 */

import {
  classifyFileRisk,
  riskLevelRank,
  type FileRisk,
  type FileRiskKind,
  type FileRiskLevel,
} from "./file-risk";
import { getCausalStepsForFile } from "./causal-links";
import {
  buildValidationLane,
  type ValidationItem,
} from "./validation-lane";
import type { DiffStatus, FileDiff, Session } from "./types";

export type ReviewGroupId =
  | "security"
  | "config"
  | "binary"
  | "large"
  | "source"
  | "generated"
  | "test"
  | "docs"
  | "other";

export interface ReviewQueueItem {
  fileId: string;
  path: string;
  status: DiffStatus;
  risk: FileRisk;
  groupId: ReviewGroupId;
  additions: number;
  deletions: number;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  conflict?: boolean;
  relatedTraceCount: number;
  unresolvedCommentCount: number;
  /** One-line “why / what” from causal or path heuristics. */
  intentSummary: string;
}

export interface ReviewQueueGroup {
  id: ReviewGroupId;
  label: string;
  description: string;
  items: ReviewQueueItem[];
  /** Worst risk level in the group. */
  peakLevel: FileRiskLevel;
}

export type ReviewIssueKind =
  | "test_failure"
  | "build_failure"
  | "policy"
  | "incomplete_tool"
  | "parser"
  | "conflict"
  | "secret"
  | "comment"
  | "error";

export interface ReviewIssueMarker {
  id: string;
  kind: ReviewIssueKind;
  severity: "error" | "warn" | "info";
  title: string;
  detail: string;
  fileId?: string;
  path?: string;
  traceNodeId?: string;
  timestamp?: number;
}

export interface ReviewQueueSummary {
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  securityCount: number;
  highRiskCount: number;
  issueCount: number;
  needsAttention: boolean;
  headline: string;
}

export interface ReviewQueue {
  groups: ReviewQueueGroup[];
  /** Flat order for keyboard navigation (risk then path). */
  flat: ReviewQueueItem[];
  issues: ReviewIssueMarker[];
  summary: ReviewQueueSummary;
}

const GROUP_META: Record<
  ReviewGroupId,
  { label: string; description: string; order: number }
> = {
  security: {
    label: "Security-sensitive",
    description: "Secrets, keys, credentials",
    order: 0,
  },
  config: {
    label: "Configuration",
    description: "Package, build, CI, tooling",
    order: 1,
  },
  binary: {
    label: "Binary",
    description: "Non-text or opaque blobs",
    order: 2,
  },
  large: {
    label: "Large changes",
    description: "High line churn",
    order: 3,
  },
  source: {
    label: "Application source",
    description: "Primary code paths",
    order: 4,
  },
  generated: {
    label: "Generated / lockfiles",
    description: "Artifacts and lockfiles",
    order: 5,
  },
  test: {
    label: "Tests",
    description: "Specs, fixtures, snapshots",
    order: 6,
  },
  docs: {
    label: "Docs",
    description: "Markdown and prose",
    order: 7,
  },
  other: {
    label: "Other",
    description: "Unclassified paths",
    order: 8,
  },
};

function kindToGroup(kind: FileRiskKind): ReviewGroupId {
  switch (kind) {
    case "security":
      return "security";
    case "config":
      return "config";
    case "binary":
      return "binary";
    case "large":
      return "large";
    case "source":
      return "source";
    case "generated":
      return "generated";
    case "test":
      return "test";
    case "docs":
      return "docs";
    default:
      return "other";
  }
}

function intentForFile(
  session: Pick<Session, "nodes" | "files" | "reviewComments">,
  file: FileDiff,
  risk: FileRisk
): string {
  if (file.conflict) return "Merge conflict — resolve before commit";
  if (file.isSecret || risk.kind === "security") {
    return risk.description;
  }

  const causal = getCausalStepsForFile(session, file.id);
  if (causal?.steps.length) {
    const tool = [...causal.steps]
      .reverse()
      .find((s) => s.kind === "tool" || s.kind === "file");
    if (tool) {
      const title = tool.toolName || tool.title;
      return title.length > 72 ? `${title.slice(0, 69)}…` : title;
    }
    const first = causal.steps[0];
    if (first?.summary) {
      const s = first.summary.trim();
      return s.length > 72 ? `${s.slice(0, 69)}…` : s;
    }
  }

  const verb =
    file.status === "added"
      ? "Added"
      : file.status === "deleted"
        ? "Deleted"
        : file.status === "renamed"
          ? "Renamed"
          : "Modified";
  return `${verb} · ${risk.label.toLowerCase()}`;
}

function itemFromFile(
  session: Pick<Session, "nodes" | "files" | "reviewComments">,
  file: FileDiff
): ReviewQueueItem {
  const risk = classifyFileRisk(file.path, file);
  const comments = (session.reviewComments ?? []).filter(
    (c) => c.path === file.path && !c.resolved
  );
  return {
    fileId: file.id,
    path: file.path,
    status: file.status,
    risk,
    groupId: kindToGroup(risk.kind),
    additions: file.additions,
    deletions: file.deletions,
    staged: file.staged,
    unstaged: file.unstaged,
    untracked: file.untracked,
    conflict: file.conflict,
    relatedTraceCount: file.relatedTraceIds.length,
    unresolvedCommentCount: comments.length,
    intentSummary: intentForFile(session, file, risk),
  };
}

function sortItems(a: ReviewQueueItem, b: ReviewQueueItem): number {
  if (a.conflict !== b.conflict) return a.conflict ? -1 : 1;
  const pr = a.risk.sortPriority - b.risk.sortPriority;
  if (pr !== 0) return pr;
  const lr = riskLevelRank(a.risk.level) - riskLevelRank(b.risk.level);
  if (lr !== 0) return lr;
  return a.path.localeCompare(b.path);
}

function peakLevel(items: ReviewQueueItem[]): FileRiskLevel {
  let best: FileRiskLevel = "info";
  let bestRank = 99;
  for (const i of items) {
    const r = riskLevelRank(i.risk.level);
    if (r < bestRank) {
      bestRank = r;
      best = i.risk.level;
    }
  }
  return best;
}

function pathToFileId(
  files: Record<string, FileDiff>,
  path: string
): string | undefined {
  const norm = path.replace(/\\/g, "/");
  for (const f of Object.values(files)) {
    if (f.path.replace(/\\/g, "/") === norm) return f.id;
  }
  return undefined;
}

/**
 * Persistent issue markers: failed tests, policy denials, incomplete tools,
 * parser warnings, conflicts, secrets, unresolved review comments.
 */
export function buildReviewIssueMarkers(session: Session): ReviewIssueMarker[] {
  const issues: ReviewIssueMarker[] = [];
  const files = Object.values(session.files);

  for (const f of files) {
    if (f.conflict) {
      issues.push({
        id: `conflict:${f.id}`,
        kind: "conflict",
        severity: "error",
        title: "Merge conflict",
        detail: f.path,
        fileId: f.id,
        path: f.path,
      });
    }
    if (f.isSecret) {
      issues.push({
        id: `secret:${f.id}`,
        kind: "secret",
        severity: "warn",
        title: "Secret path in diff",
        detail: f.path,
        fileId: f.id,
        path: f.path,
      });
    }
  }

  for (const c of session.reviewComments ?? []) {
    if (c.resolved) continue;
    issues.push({
      id: `comment:${c.id}`,
      kind: "comment",
      severity: "warn",
      title: "Unresolved review comment",
      detail: c.body.slice(0, 120),
      path: c.path,
      fileId: pathToFileId(session.files, c.path),
      traceNodeId: c.traceNodeId,
      timestamp: c.createdAt,
    });
  }

  let laneItems: ValidationItem[] = [];
  try {
    laneItems = buildValidationLane(session).items;
  } catch {
    laneItems = [];
  }

  for (const item of laneItems) {
    if (item.status === "failed" && item.kind === "test") {
      issues.push({
        id: `val:${item.id}`,
        kind: "test_failure",
        severity: "error",
        title: item.title,
        detail: item.detail,
        fileId: item.fileIds[0],
        path: item.paths[0],
        traceNodeId: item.traceNodeId,
        timestamp: item.timestamp,
      });
    } else if (item.status === "failed" && item.kind === "build") {
      issues.push({
        id: `val:${item.id}`,
        kind: "build_failure",
        severity: "error",
        title: item.title,
        detail: item.detail,
        fileId: item.fileIds[0],
        path: item.paths[0],
        traceNodeId: item.traceNodeId,
        timestamp: item.timestamp,
      });
    } else if (
      item.status === "blocked" ||
      item.kind === "policy" ||
      item.kind === "approval"
    ) {
      if (item.status === "blocked" || item.status === "failed") {
        issues.push({
          id: `val:${item.id}`,
          kind: "policy",
          severity: "warn",
          title: item.title,
          detail: item.detail,
          fileId: item.fileIds[0],
          path: item.paths[0],
          traceNodeId: item.traceNodeId,
          timestamp: item.timestamp,
        });
      }
    } else if (item.kind === "parser") {
      issues.push({
        id: `val:${item.id}`,
        kind: "parser",
        severity: item.severity === "error" ? "error" : "warn",
        title: item.title,
        detail: item.detail,
        traceNodeId: item.traceNodeId,
        timestamp: item.timestamp,
      });
    } else if (
      item.kind === "error" &&
      (item.status === "failed" || item.severity === "error")
    ) {
      issues.push({
        id: `val:${item.id}`,
        kind: "error",
        severity: "error",
        title: item.title,
        detail: item.detail,
        fileId: item.fileIds[0],
        path: item.paths[0],
        traceNodeId: item.traceNodeId,
        timestamp: item.timestamp,
      });
    } else if (
      (item.kind === "tool" || item.kind === "command" || item.kind === "run") &&
      (item.status === "running" || item.status === "pending")
    ) {
      // Incomplete tool/command only if session is not actively running
      // (stale incomplete) OR always surface pending as soft marker when idle.
      if (
        session.status !== "running" &&
        session.status !== "starting"
      ) {
        issues.push({
          id: `val:${item.id}`,
          kind: "incomplete_tool",
          severity: "warn",
          title: `Incomplete: ${item.title}`,
          detail: item.detail || "Tool/command never finished",
          fileId: item.fileIds[0],
          path: item.paths[0],
          traceNodeId: item.traceNodeId,
          timestamp: item.timestamp,
        });
      }
    }
  }

  // Stable order: errors first, then warn, then by time desc
  const sev = (s: ReviewIssueMarker["severity"]) =>
    s === "error" ? 0 : s === "warn" ? 1 : 2;
  issues.sort((a, b) => {
    const sd = sev(a.severity) - sev(b.severity);
    if (sd !== 0) return sd;
    return (b.timestamp ?? 0) - (a.timestamp ?? 0);
  });

  return issues;
}

/**
 * Build the ordered review queue for a session.
 */
export function buildReviewQueue(session: Session): ReviewQueue {
  const files = Object.values(session.files);
  const items = files.map((f) => itemFromFile(session, f)).sort(sortItems);

  const byGroup = new Map<ReviewGroupId, ReviewQueueItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupId) ?? [];
    list.push(item);
    byGroup.set(item.groupId, list);
  }

  const groups: ReviewQueueGroup[] = [];
  for (const [id, meta] of Object.entries(GROUP_META) as Array<
    [ReviewGroupId, (typeof GROUP_META)[ReviewGroupId]]
  >) {
    const groupItems = byGroup.get(id);
    if (!groupItems?.length) continue;
    groups.push({
      id,
      label: meta.label,
      description: meta.description,
      items: groupItems,
      peakLevel: peakLevel(groupItems),
    });
  }
  groups.sort((a, b) => GROUP_META[a.id].order - GROUP_META[b.id].order);

  const issues = buildReviewIssueMarkers(session);
  const staged = items.filter((i) => i.staged).length;
  const unstaged = items.filter((i) => i.unstaged).length;
  const untracked = items.filter((i) => i.untracked).length;
  const conflicts = items.filter((i) => i.conflict).length;
  const securityCount = items.filter((i) => i.risk.kind === "security").length;
  const highRiskCount = items.filter(
    (i) =>
      i.risk.level === "critical" ||
      i.risk.level === "high" ||
      i.conflict
  ).length;

  const errorIssues = issues.filter((i) => i.severity === "error").length;
  const needsAttention =
    conflicts > 0 ||
    securityCount > 0 ||
    errorIssues > 0 ||
    highRiskCount > 0;

  let headline: string;
  if (items.length === 0) {
    headline = "No file changes";
  } else if (conflicts > 0) {
    headline = `${conflicts} conflict${conflicts === 1 ? "" : "s"} · ${items.length} files`;
  } else if (securityCount > 0) {
    headline = `${securityCount} security path${securityCount === 1 ? "" : "s"} · ${items.length} files`;
  } else if (errorIssues > 0) {
    headline = `${errorIssues} open failure${errorIssues === 1 ? "" : "s"} · ${items.length} files`;
  } else {
    headline = `${items.length} file${items.length === 1 ? "" : "s"} · ${staged} staged`;
  }

  return {
    groups,
    flat: items,
    issues,
    summary: {
      total: items.length,
      staged,
      unstaged,
      untracked,
      conflicts,
      securityCount,
      highRiskCount,
      issueCount: issues.length,
      needsAttention,
      headline,
    },
  };
}

/** Index of selected file in the flat review order (−1 if missing). */
export function reviewQueueIndex(
  queue: ReviewQueue,
  fileId: string | null | undefined
): number {
  if (!fileId) return -1;
  return queue.flat.findIndex((i) => i.fileId === fileId);
}

export function nextReviewFileId(
  queue: ReviewQueue,
  fileId: string | null | undefined,
  delta: 1 | -1
): string | null {
  if (queue.flat.length === 0) return null;
  const idx = reviewQueueIndex(queue, fileId);
  if (idx < 0) {
    return delta > 0 ? queue.flat[0].fileId : queue.flat[queue.flat.length - 1].fileId;
  }
  const next = idx + delta;
  if (next < 0 || next >= queue.flat.length) return queue.flat[idx].fileId;
  return queue.flat[next].fileId;
}
