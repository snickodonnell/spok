/**
 * Causal trace ↔ file linking helpers for the Review workbench.
 * Pure functions — safe for unit tests and UI selectors.
 */

import type { FileDiff, ReviewComment, Session, TraceNode } from "./types";

export type CausalStepKind =
  | "thinking"
  | "tool"
  | "file"
  | "approval"
  | "error"
  | "message"
  | "plan"
  | "system"
  | "other";

export interface CausalStep {
  nodeId: string;
  kind: CausalStepKind;
  title: string;
  summary: string;
  timestamp: number;
  status?: TraceNode["status"];
  toolName?: string;
  /** True when this node is directly listed on the file's relatedTraceIds. */
  direct: boolean;
}

export interface CausalBundle {
  fileId: string;
  path: string;
  steps: CausalStep[];
  comments: ReviewComment[];
  /** Trace ids that could not be resolved to a live node. */
  missingTraceIds: string[];
}

function classifyNode(n: TraceNode): CausalStepKind {
  switch (n.type) {
    case "thinking":
    case "reasoning":
      return "thinking";
    case "tool_call":
    case "tool_result":
      return "tool";
    case "file_change":
      return "file";
    case "error":
      return "error";
    case "message":
      return "message";
    case "plan":
    case "plan_update":
    case "goal":
      return "plan";
    case "system":
      return "system";
    default:
      if (
        n.title.toLowerCase().includes("approv") ||
        n.content.toLowerCase().includes("approv")
      ) {
        return "approval";
      }
      return "other";
  }
}

function stepFromNode(n: TraceNode, direct: boolean): CausalStep {
  const summary =
    n.summary?.trim() ||
    n.content.trim().slice(0, 160) ||
    n.title;
  return {
    nodeId: n.id,
    kind: classifyNode(n),
    title: n.title || n.toolName || n.type,
    summary,
    timestamp: n.timestamp,
    status: n.status,
    toolName: n.toolName,
    direct,
  };
}

/**
 * Collect causal steps for a file: direct relatedTraceIds plus reverse links
 * from trace nodes that point at this file (or path).
 */
export function getCausalStepsForFile(
  session: Pick<Session, "nodes" | "files" | "reviewComments">,
  fileId: string
): CausalBundle | null {
  const file = session.files[fileId];
  if (!file) return null;

  const seen = new Set<string>();
  const steps: CausalStep[] = [];
  const missingTraceIds: string[] = [];

  for (const id of file.relatedTraceIds) {
    const n = session.nodes[id];
    if (!n) {
      missingTraceIds.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    steps.push(stepFromNode(n, true));
  }

  // Reverse: nodes that link to this file id or path
  for (const n of Object.values(session.nodes)) {
    if (seen.has(n.id)) continue;
    const hits = n.links.some(
      (l) =>
        (l.kind === "file" &&
          (l.targetId === fileId || l.path === file.path)) ||
        (l.path != null && l.path === file.path)
    );
    if (!hits) continue;
    seen.add(n.id);
    steps.push(stepFromNode(n, false));
  }

  // Path-based file_change nodes (agent may emit path without formal link)
  for (const n of Object.values(session.nodes)) {
    if (seen.has(n.id)) continue;
    if (n.type !== "file_change") continue;
    const metaPath =
      typeof n.meta?.path === "string" ? n.meta.path : undefined;
    if (
      n.title === file.path ||
      n.content.includes(file.path) ||
      metaPath === file.path
    ) {
      seen.add(n.id);
      steps.push(stepFromNode(n, false));
    }
  }

  steps.sort((a, b) => a.timestamp - b.timestamp);

  const comments = (session.reviewComments ?? []).filter(
    (c) => c.path === file.path
  );

  return {
    fileId,
    path: file.path,
    steps,
    comments,
    missingTraceIds,
  };
}

/** Files that claim a causal relationship with a trace node. */
export function getFilesForTrace(
  session: Pick<Session, "nodes" | "files">,
  traceId: string
): FileDiff[] {
  const node = session.nodes[traceId];
  const out: FileDiff[] = [];
  const seen = new Set<string>();

  if (node) {
    for (const link of node.links) {
      if (link.kind !== "file") continue;
      const f =
        session.files[link.targetId] ||
        Object.values(session.files).find((x) => x.path === link.path);
      if (f && !seen.has(f.id)) {
        seen.add(f.id);
        out.push(f);
      }
    }
  }

  for (const f of Object.values(session.files)) {
    if (seen.has(f.id)) continue;
    if (f.relatedTraceIds.includes(traceId)) {
      seen.add(f.id);
      out.push(f);
    }
  }

  return out;
}

export function causalKindLabel(kind: CausalStepKind): string {
  switch (kind) {
    case "thinking":
      return "Thinking";
    case "tool":
      return "Tool";
    case "file":
      return "File";
    case "approval":
      return "Approval";
    case "error":
      return "Error";
    case "message":
      return "Message";
    case "plan":
      return "Plan";
    case "system":
      return "System";
    default:
      return "Step";
  }
}
