/**
 * Causal trace ↔ file / hunk linking helpers for the Review workbench.
 * Pure functions — safe for unit tests and UI selectors.
 */

import type {
  DiffHunk,
  FileDiff,
  ReviewComment,
  Session,
  TraceLink,
  TraceNode,
} from "./types";

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
  /** 0–100 relevance when scoped to a hunk (higher = more specific). */
  matchScore?: number;
  /** Short reason for the hunk match (UI caption). */
  matchReason?: string;
  /** True when this step is specific to the focused hunk (not just file-wide). */
  hunkScoped?: boolean;
}

export interface CausalBundle {
  fileId: string;
  path: string;
  steps: CausalStep[];
  comments: ReviewComment[];
  /** Trace ids that could not be resolved to a live node. */
  missingTraceIds: string[];
}

export interface HunkCausalBundle extends CausalBundle {
  hunkId: string;
  hunkIndex: number;
  hunkHeader: string;
  /** Steps with strong hunk affinity (matchScore >= threshold). */
  hunkSteps: CausalStep[];
  /** Remaining file-level context steps. */
  broaderSteps: CausalStep[];
  newLineStart: number;
  newLineEnd: number;
}

const HUNK_MATCH_THRESHOLD = 40;

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

function stepFromNode(
  n: TraceNode,
  direct: boolean,
  extra?: Pick<CausalStep, "matchScore" | "matchReason" | "hunkScoped">
): CausalStep {
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
    ...extra,
  };
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function hunkNewRange(hunk: DiffHunk): { start: number; end: number } {
  const start = Math.max(1, hunk.newStart || 1);
  const end = Math.max(start, start + Math.max(0, (hunk.newLines || 1) - 1));
  return { start, end };
}

function hunkOldRange(hunk: DiffHunk): { start: number; end: number } {
  const start = Math.max(1, hunk.oldStart || 1);
  const end = Math.max(start, start + Math.max(0, (hunk.oldLines || 1) - 1));
  return { start, end };
}

/** Distinct non-context lines from a hunk for content matching. */
export function hunkSignatureLines(hunk: DiffHunk, max = 6): string[] {
  const out: string[] = [];
  for (const line of hunk.lines) {
    if (line.type === "context") continue;
    const t = line.content.trim();
    if (t.length < 6) continue;
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function linkHitsHunk(
  link: TraceLink,
  file: FileDiff,
  hunk: DiffHunk
): { score: number; reason: string } | null {
  const { start: nStart, end: nEnd } = hunkNewRange(hunk);
  const { start: oStart, end: oEnd } = hunkOldRange(hunk);

  if (link.kind === "hunk" && link.targetId === hunk.id) {
    return { score: 100, reason: "linked hunk" };
  }

  if (
    (link.kind === "hunk" || link.kind === "file") &&
    link.lineStart != null
  ) {
    const lStart = link.lineStart;
    const lEnd = link.lineEnd ?? link.lineStart;
    if (
      rangesOverlap(lStart, lEnd, nStart, nEnd) ||
      rangesOverlap(lStart, lEnd, oStart, oEnd)
    ) {
      const pathOk =
        !link.path ||
        link.path.replace(/\\/g, "/") === file.path.replace(/\\/g, "/");
      if (pathOk || link.targetId === file.id || link.targetId === hunk.id) {
        return { score: 90, reason: `lines ${lStart}–${lEnd}` };
      }
    }
  }

  return null;
}

/**
 * Score how specifically a trace node explains a given hunk.
 */
export function scoreNodeForHunk(
  node: TraceNode,
  file: FileDiff,
  hunk: DiffHunk,
  hunkIndex: number,
  fileChangeOrderIndex: number | null,
  fileChangeCount: number
): { score: number; reason: string } {
  let best = { score: 0, reason: "file context" };

  for (const link of node.links) {
    const hit = linkHitsHunk(link, file, hunk);
    if (hit && hit.score > best.score) best = hit;
  }

  const sigs = hunkSignatureLines(hunk);
  if (sigs.length > 0) {
    const hay = `${node.content}\n${node.title}\n${node.summary ?? ""}`;
    let hits = 0;
    for (const s of sigs) {
      if (hay.includes(s)) hits += 1;
    }
    if (hits > 0) {
      const score = Math.min(85, 45 + hits * 12);
      if (score > best.score) {
        best = {
          score,
          reason: hits === 1 ? "matching edit line" : `${hits} matching lines`,
        };
      }
    }
  }

  // Sequential zip: Nth file_change on this path ↔ Nth hunk when counts align
  if (
    node.type === "file_change" &&
    fileChangeOrderIndex != null &&
    fileChangeCount > 1 &&
    file.hunks.length > 1 &&
    fileChangeOrderIndex === hunkIndex
  ) {
    if (70 > best.score) {
      best = { score: 70, reason: "edit order match" };
    }
  }

  // Sole file_change for a multi-hunk rewrite still owns all hunks moderately
  if (node.type === "file_change" && fileChangeCount === 1) {
    if (55 > best.score) {
      best = { score: 55, reason: "file rewrite" };
    }
  }

  // Parent tool that wrote this path
  if (
    (node.type === "tool_call" || node.type === "tool_result") &&
    (node.content.includes(file.path) ||
      node.title.includes(file.path) ||
      node.toolName === "write" ||
      node.toolName === "search_replace" ||
      node.toolName === "apply_patch")
  ) {
    if (50 > best.score) {
      best = { score: 50, reason: "edit tool" };
    }
  }

  // Direct related without finer grain
  if (file.relatedTraceIds.includes(node.id) && best.score < 25) {
    best = { score: 25, reason: "related event" };
  }

  return best;
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

  // Reverse: nodes that link to this file id or path (incl. hunk links)
  for (const n of Object.values(session.nodes)) {
    if (seen.has(n.id)) continue;
    const hits = n.links.some(
      (l) =>
        (l.kind === "file" &&
          (l.targetId === fileId || l.path === file.path)) ||
        (l.kind === "hunk" &&
          (l.path === file.path ||
            file.hunks.some((h) => h.id === l.targetId))) ||
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

/**
 * Causal steps ranked for a specific diff hunk ("why this hunk changed").
 */
export function getCausalStepsForHunk(
  session: Pick<Session, "nodes" | "files" | "reviewComments">,
  fileId: string,
  hunkIndex: number
): HunkCausalBundle | null {
  const file = session.files[fileId];
  if (!file) return null;
  const hunk = file.hunks[hunkIndex];
  if (!hunk) return null;

  const base = getCausalStepsForFile(session, fileId);
  if (!base) return null;

  const fileChanges = base.steps
    .map((s) => session.nodes[s.nodeId])
    .filter((n): n is TraceNode => !!n && n.type === "file_change")
    .sort((a, b) => a.timestamp - b.timestamp);

  const scored: CausalStep[] = base.steps.map((step) => {
    const node = session.nodes[step.nodeId];
    if (!node) {
      return { ...step, matchScore: 0, hunkScoped: false };
    }
    const fcIdx = fileChanges.findIndex((n) => n.id === node.id);
    const { score, reason } = scoreNodeForHunk(
      node,
      file,
      hunk,
      hunkIndex,
      fcIdx >= 0 ? fcIdx : null,
      fileChanges.length
    );
    return {
      ...step,
      matchScore: score,
      matchReason: reason,
      hunkScoped: score >= HUNK_MATCH_THRESHOLD,
    };
  });

  // Also pull nodes that only link this hunk (may not be in file bundle)
  for (const n of Object.values(session.nodes)) {
    if (scored.some((s) => s.nodeId === n.id)) continue;
    const hit = n.links.some((l) => {
      if (l.kind === "hunk" && l.targetId === hunk.id) return true;
      if (l.lineStart == null) return false;
      const { start, end } = hunkNewRange(hunk);
      return (
        (l.path === file.path || !l.path) &&
        rangesOverlap(l.lineStart, l.lineEnd ?? l.lineStart, start, end)
      );
    });
    if (!hit) continue;
    const { score, reason } = scoreNodeForHunk(
      n,
      file,
      hunk,
      hunkIndex,
      null,
      fileChanges.length
    );
    scored.push(
      stepFromNode(n, false, {
        matchScore: Math.max(score, 90),
        matchReason: reason,
        hunkScoped: true,
      })
    );
  }

  scored.sort((a, b) => {
    const sd = (b.matchScore ?? 0) - (a.matchScore ?? 0);
    if (sd !== 0) return sd;
    return a.timestamp - b.timestamp;
  });

  const hunkSteps = scored.filter(
    (s) => (s.matchScore ?? 0) >= HUNK_MATCH_THRESHOLD
  );
  const broaderSteps = scored.filter(
    (s) => (s.matchScore ?? 0) < HUNK_MATCH_THRESHOLD
  );

  const comments = base.comments.filter(
    (c) =>
      c.hunkId === hunk.id ||
      (c.line != null &&
        rangesOverlap(
          c.line,
          c.line,
          hunkNewRange(hunk).start,
          hunkNewRange(hunk).end
        ))
  );

  const { start, end } = hunkNewRange(hunk);

  return {
    fileId,
    path: file.path,
    hunkId: hunk.id,
    hunkIndex,
    hunkHeader: hunk.header,
    steps: scored,
    hunkSteps,
    broaderSteps,
    comments: comments.length ? comments : base.comments,
    missingTraceIds: base.missingTraceIds,
    newLineStart: start,
    newLineEnd: end,
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
      if (link.kind !== "file" && link.kind !== "hunk") continue;
      if (link.kind === "hunk") {
        const f =
          Object.values(session.files).find((x) =>
            x.hunks.some((h) => h.id === link.targetId)
          ) ||
          (link.path
            ? Object.values(session.files).find((x) => x.path === link.path)
            : undefined);
        if (f && !seen.has(f.id)) {
          seen.add(f.id);
          out.push(f);
        }
        continue;
      }
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

/**
 * Build TraceLink[] for a file_change event after hunks are known.
 * Used by the session reducer so Why-this-hunk can resolve line ranges.
 */
export function buildFileChangeLinks(
  file: FileDiff,
  path: string
): TraceLink[] {
  const links: TraceLink[] = [
    {
      kind: "file",
      targetId: file.id,
      path,
      label: path,
    },
  ];
  for (const hunk of file.hunks) {
    const { start, end } = hunkNewRange(hunk);
    links.push({
      kind: "hunk",
      targetId: hunk.id,
      path,
      label: hunk.header,
      lineStart: start,
      lineEnd: end,
    });
  }
  return links;
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
