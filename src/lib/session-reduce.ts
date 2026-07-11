/**
 * Pure session stream reducer — shared by the Zustand store and batch ingest.
 * Applies stamped StreamEvents to session + expanded-node set without
 * touching React/Zustand. Batch path mutates once and freezes at the end.
 */

import { nanoid } from "nanoid";
import type { FileDiff, Session, StreamEvent, TraceNode } from "./types";
import { buildFileTree, createFileDiff } from "./diff-utils";
import { streamEventToNodeType, extractPaths } from "./parser";
import {
  isNonThoughtContent,
  mergeStreamingText,
  preferFullerText,
} from "./trace-text";
import { extractProviderTokens, mergeTokensIntoMetrics } from "./usage";

export type ReduceResult = {
  session: Session;
  expandedNodeIds: Set<string>;
  linkedHighlightFileId?: string | null;
  /** When true, metrics counts need a full recompute from nodes/files. */
  metricsDirty: boolean;
};

const MAX_EVENT_LOG = 8_000;

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function attachChild(
  nodes: Record<string, TraceNode>,
  parentId: string | null,
  childId: string
) {
  if (!parentId || !nodes[parentId]) return;
  if (!nodes[parentId].children.includes(childId)) {
    nodes[parentId].children = [...nodes[parentId].children, childId];
  }
}

function upsertNode(
  nodes: Record<string, TraceNode>,
  rootTraceIds: string[],
  node: TraceNode
) {
  const existing = nodes[node.id];
  if (existing) {
    nodes[node.id] = {
      ...existing,
      ...node,
      children: existing.children,
      parentId: node.parentId ?? existing.parentId,
      depth: node.parentId ? node.depth : existing.depth,
      links: node.links.length ? node.links : existing.links,
    };
    return;
  }
  nodes[node.id] = node;
  if (!node.parentId) {
    if (!rootTraceIds.includes(node.id)) rootTraceIds.push(node.id);
  } else {
    attachChild(nodes, node.parentId, node.id);
  }
}

function appendEventLog(session: Session, stamped: StreamEvent): Session {
  const prevLog = session.eventLog ?? [];
  const nextLog =
    prevLog.length >= MAX_EVENT_LOG
      ? [...prevLog.slice(prevLog.length - MAX_EVENT_LOG + 1), stamped]
      : [...prevLog, stamped];
  return {
    ...session,
    eventLog: nextLog,
    eventCount: (session.eventCount ?? prevLog.length) + 1,
  };
}

/** Single-pass metrics — avoids 5× filter + 2× reduce over the same arrays. */
export function recomputeSessionMetrics(session: Session) {
  const startedAt = session.metrics.startedAt ?? session.createdAt;
  const endedAt =
    session.status === "completed" ||
    session.status === "error" ||
    session.status === "stopped" ||
    session.status === "ready"
      ? session.metrics.endedAt
      : null;

  let toolCallCount = 0;
  let thinkingSteps = 0;
  let subagentCount = 0;
  let errorCount = 0;
  for (const n of Object.values(session.nodes)) {
    if (n.type === "tool_call") toolCallCount++;
    if (n.type === "thinking" || n.type === "reasoning") thinkingSteps++;
    if (n.type === "subagent") subagentCount++;
    if (n.type === "error" || n.status === "error") errorCount++;
  }

  let linesAdded = 0;
  let linesDeleted = 0;
  const fileList = Object.values(session.files);
  for (const f of fileList) {
    linesAdded += f.additions;
    linesDeleted += f.deletions;
  }

  // Prefer a stable wall-clock sample: for live runs the UI computes elapsed
  // from startedAt. Reusing the previous elapsedMs when still running avoids
  // a new metrics object identity every stream batch when counts are unchanged.
  const elapsedMs =
    endedAt != null
      ? endedAt - startedAt
      : session.metrics.elapsedMs || 0;

  const next = {
    startedAt,
    endedAt,
    elapsedMs,
    toolCallCount,
    thinkingSteps,
    filesChanged: fileList.length,
    linesAdded,
    linesDeleted,
    subagentCount,
    errorCount,
    tokensEstimate: session.metrics.tokensEstimate,
    tokensLimit: session.metrics.tokensLimit,
  };

  const prev = session.metrics;
  if (
    prev.startedAt === next.startedAt &&
    prev.endedAt === next.endedAt &&
    prev.elapsedMs === next.elapsedMs &&
    prev.toolCallCount === next.toolCallCount &&
    prev.thinkingSteps === next.thinkingSteps &&
    prev.filesChanged === next.filesChanged &&
    prev.linesAdded === next.linesAdded &&
    prev.linesDeleted === next.linesDeleted &&
    prev.subagentCount === next.subagentCount &&
    prev.errorCount === next.errorCount &&
    prev.tokensEstimate === next.tokensEstimate &&
    prev.tokensLimit === next.tokensLimit
  ) {
    return prev;
  }
  return next;
}

/** Path → fileId index so we don't scan Object.values(files) every event. */
function buildPathIndex(files: Record<string, FileDiff>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const f of Object.values(files)) {
    idx.set(normalizeRepoPath(f.path), f.id);
  }
  return idx;
}

function findFileByPath(
  files: Record<string, FileDiff>,
  pathIndex: Map<string, string>,
  path: string
): FileDiff | undefined {
  const norm = normalizeRepoPath(path);
  const byId = pathIndex.get(norm);
  if (byId && files[byId]) return files[byId];
  // suffix match fallback (rare)
  for (const f of Object.values(files)) {
    if (f.path.endsWith(path) || f.path.endsWith(norm)) return f;
  }
  return undefined;
}

type WorkState = {
  status: Session["status"];
  metrics: Session["metrics"];
  nodes: Record<string, TraceNode>;
  files: Record<string, FileDiff>;
  rootTraceIds: string[];
  selectedTraceId: string | null;
  selectedFileId: string | null;
  updatedAt: number;
  eventLog: StreamEvent[];
  eventCount: number;
  filesDirty: boolean;
  /** Cached id of most recent thinking/reasoning node (streaming coalesce). */
  latestThoughtId: string | null;
  /** Cached id of most recent tool_call (tool_result parent). */
  latestToolCallId: string | null;
  pathIndex: Map<string, string>;
  expanded: Set<string>;
  linkedHighlightFileId: string | null | undefined;
  metricsDirty: boolean;
};

function findLatestOfType(
  nodes: Record<string, TraceNode>,
  types: Set<string>
): string | null {
  let bestId: string | null = null;
  let bestTs = -Infinity;
  for (const n of Object.values(nodes)) {
    if (!types.has(n.type)) continue;
    if (n.timestamp >= bestTs) {
      bestTs = n.timestamp;
      bestId = n.id;
    }
  }
  return bestId;
}

function createWorkState(
  session: Session,
  expandedNodeIds: Set<string>
): WorkState {
  const nodes = { ...session.nodes };
  const files = { ...session.files };
  return {
    status: session.status,
    metrics: { ...session.metrics },
    nodes,
    files,
    rootTraceIds: [...session.rootTraceIds],
    selectedTraceId: session.selectedTraceId,
    selectedFileId: session.selectedFileId,
    updatedAt: session.updatedAt,
    eventLog: session.eventLog ? session.eventLog.slice() : [],
    eventCount: session.eventCount ?? session.eventLog?.length ?? 0,
    filesDirty: false,
    latestThoughtId: findLatestOfType(
      nodes,
      new Set(["thinking", "reasoning"])
    ),
    latestToolCallId: findLatestOfType(nodes, new Set(["tool_call"])),
    pathIndex: buildPathIndex(files),
    expanded: new Set(expandedNodeIds),
    linkedHighlightFileId: undefined,
    metricsDirty: false,
  };
}

function pushLog(ws: WorkState, event: StreamEvent) {
  ws.eventLog.push(event);
  ws.eventCount += 1;
  if (ws.eventLog.length > MAX_EVENT_LOG) {
    ws.eventLog = ws.eventLog.slice(ws.eventLog.length - MAX_EVENT_LOG);
  }
}

function applyEventToWork(ws: WorkState, event: StreamEvent): void {
  if (event.type === "session_start") {
    ws.status = "running";
    ws.metrics = { ...ws.metrics, startedAt: event.timestamp };
    ws.updatedAt = Date.now();
    pushLog(ws, event);
    ws.metricsDirty = true;
    return;
  }

  if (event.type === "session_end") {
    ws.status = event.status === "error" ? "error" : "completed";
    ws.metrics = { ...ws.metrics, endedAt: event.timestamp };
    ws.updatedAt = Date.now();
    pushLog(ws, event);
    ws.metricsDirty = true;
    return;
  }

  let workingEvent = event;

  // File / diff events
  if (
    (workingEvent.type === "file_change" || workingEvent.type === "diff") &&
    workingEvent.path
  ) {
    const path = normalizeRepoPath(workingEvent.path);
    const existing = findFileByPath(ws.files, ws.pathIndex, path);
    const fd = createFileDiff({
      path: existing?.path ?? path,
      oldPath: workingEvent.oldPath,
      oldContent: workingEvent.oldContent ?? existing?.oldContent ?? "",
      newContent: workingEvent.newContent ?? existing?.newContent ?? "",
      status: workingEvent.diffStatus,
      relatedTraceIds: existing?.relatedTraceIds ?? [],
      timestamp: workingEvent.timestamp,
    });
    if (existing) {
      fd.id = existing.id;
      fd.relatedTraceIds = [...existing.relatedTraceIds];
    }
    if (workingEvent.id && !fd.relatedTraceIds.includes(workingEvent.id)) {
      fd.relatedTraceIds.push(workingEvent.id);
    }
    ws.files[fd.id] = fd;
    ws.pathIndex.set(normalizeRepoPath(fd.path), fd.id);
    ws.filesDirty = true;
    ws.selectedFileId = fd.id;

    const nodeId = workingEvent.id || nanoid(10);
    const prev = ws.nodes[nodeId];
    const parentId = workingEvent.parentId ?? prev?.parentId ?? null;
    const depth =
      parentId && ws.nodes[parentId] ? ws.nodes[parentId].depth + 1 : 0;
    upsertNode(ws.nodes, ws.rootTraceIds, {
      id: nodeId,
      parentId,
      type: "file_change",
      title: workingEvent.title || `File: ${path}`,
      content:
        workingEvent.content ||
        `${workingEvent.diffStatus ?? "modified"} ${path}`,
      summary: path,
      timestamp: workingEvent.timestamp,
      status: "success",
      children: prev?.children ?? [],
      links: [
        {
          kind: "file",
          targetId: fd.id,
          path,
          label: path,
        },
      ],
      depth,
      meta: workingEvent.meta,
    });
    ws.expanded.add(nodeId);
    if (parentId) ws.expanded.add(parentId);
    ws.linkedHighlightFileId = fd.id;
    ws.selectedTraceId = nodeId;
    if (ws.status === "idle" || ws.status === "ready") {
      ws.status = "running";
    }
    ws.updatedAt = Date.now();
    pushLog(ws, workingEvent);
    ws.metricsDirty = true;
    return;
  }

  // Generic trace node (upsert by id for chunk coalescing)
  let nodeId = workingEvent.id || nanoid(10);
  let existingNode = ws.nodes[nodeId];
  const isThoughtType =
    workingEvent.type === "thinking" || workingEvent.type === "reasoning";
  if (isThoughtType) {
    const incoming = workingEvent.content || "";
    if (
      incoming &&
      isNonThoughtContent(incoming) &&
      !incoming.includes("\n")
    ) {
      workingEvent = { ...workingEvent, content: "", summary: undefined };
    } else if (incoming) {
      const latestThought = ws.latestThoughtId
        ? ws.nodes[ws.latestThoughtId]
        : undefined;
      if (latestThought) {
        const prev = latestThought.content || "";
        const sameId =
          !!workingEvent.id && workingEvent.id === latestThought.id;
        const cumulative =
          incoming.startsWith(prev) ||
          (prev.startsWith(incoming) && incoming.length < prev.length);
        if (sameId || cumulative) {
          nodeId = latestThought.id;
          existingNode = latestThought;
          workingEvent = {
            ...workingEvent,
            id: nodeId,
            content: preferFullerText(
              mergeStreamingText(prev, incoming),
              preferFullerText(incoming, prev)
            ),
          };
        }
      }
    }
  }

  let resolvedParent =
    workingEvent.parentId ?? existingNode?.parentId ?? null;
  if (workingEvent.type === "tool_result" && !resolvedParent) {
    const toolCallId = workingEvent.meta?.toolCallId as string | undefined;
    if (toolCallId) {
      if (ws.nodes[toolCallId]) {
        resolvedParent = toolCallId;
      } else {
        for (const n of Object.values(ws.nodes)) {
          if (n.meta?.toolCallId === toolCallId) {
            resolvedParent = n.id;
            break;
          }
        }
      }
    }
    if (!resolvedParent && ws.latestToolCallId) {
      resolvedParent = ws.latestToolCallId;
    }
  }
  if (
    !resolvedParent &&
    !existingNode &&
    (workingEvent.type === "thinking" ||
      workingEvent.type === "tool_call" ||
      workingEvent.type === "plan" ||
      workingEvent.type === "subagent_start")
  ) {
    const lastRoot = ws.rootTraceIds[ws.rootTraceIds.length - 1];
    if (lastRoot && ws.nodes[lastRoot]?.type === "goal") {
      resolvedParent = lastRoot;
    }
  }

  const depth =
    resolvedParent && ws.nodes[resolvedParent]
      ? ws.nodes[resolvedParent].depth + 1
      : (existingNode?.depth ?? 0);

  const links = [...(workingEvent.links ?? existingNode?.links ?? [])];
  const contentStr = workingEvent.content || "";
  const paths = contentStr ? extractPaths(contentStr) : [];
  const bareFile = workingEvent.path
    ? [workingEvent.path]
    : contentStr
      ? contentStr.match(
          /(?:^|[\s`"'])([a-zA-Z0-9_.-]+\.(?:md|ts|tsx|js|json|py|rs|go|css|html))\b/g
        ) ?? []
      : [];
  if (paths.length || bareFile.length) {
    for (const p of [...paths, ...bareFile.map((x) => x.trim())]) {
      const clean = p.replace(/^[\s`"']+/, "");
      const f = findFileByPath(ws.files, ws.pathIndex, clean);
      if (f && !links.some((l) => l.targetId === f.id)) {
        links.push({
          kind: "file",
          targetId: f.id,
          path: f.path,
          label: f.path,
        });
        if (!f.relatedTraceIds.includes(nodeId)) {
          ws.files[f.id] = {
            ...f,
            relatedTraceIds: [...f.relatedTraceIds, nodeId],
          };
          ws.filesDirty = true;
        }
      }
    }
  }

  if (
    workingEvent.type === "tool_result" &&
    existingNode?.type === "tool_call"
  ) {
    upsertNode(ws.nodes, ws.rootTraceIds, {
      ...existingNode,
      type: "tool_call",
      title: workingEvent.title || existingNode.title,
      content: workingEvent.content || existingNode.content,
      summary: workingEvent.content
        ? workingEvent.content.slice(0, 120)
        : existingNode.summary,
      timestamp: existingNode.timestamp,
      durationMs: workingEvent.durationMs,
      status: workingEvent.status ?? "success",
      children: existingNode.children,
      links,
      depth: existingNode.depth,
      toolName: workingEvent.toolName || existingNode.toolName,
      meta: { ...existingNode.meta, ...workingEvent.meta },
    });
  } else {
    const isProse =
      workingEvent.type === "thinking" ||
      workingEvent.type === "reasoning" ||
      workingEvent.type === "message" ||
      workingEvent.type === "plan" ||
      workingEvent.type === "plan_update";
    const nextContent = isProse
      ? preferFullerText(
          mergeStreamingText(
            existingNode?.content || "",
            workingEvent.content || ""
          ),
          preferFullerText(workingEvent.content, existingNode?.content)
        )
      : workingEvent.content !== undefined && workingEvent.content !== ""
        ? workingEvent.content
        : existingNode?.content || "";
    const nextSummary = isProse
      ? preferFullerText(
          workingEvent.summary ||
            (nextContent
              ? nextContent.replace(/\s+/g, " ").trim().slice(0, 160)
              : undefined),
          existingNode?.summary
        )
      : workingEvent.summary ||
        (nextContent
          ? nextContent
              .split(/\r?\n/)
              .find((l) => l.trim())
              ?.trim()
              .slice(0, 160)
          : undefined) ||
        existingNode?.summary;

    upsertNode(ws.nodes, ws.rootTraceIds, {
      id: nodeId,
      parentId: resolvedParent,
      type: streamEventToNodeType(workingEvent.type),
      title: workingEvent.title || existingNode?.title || workingEvent.type,
      content: nextContent,
      summary: nextSummary,
      timestamp: existingNode?.timestamp ?? workingEvent.timestamp,
      durationMs: workingEvent.durationMs ?? existingNode?.durationMs,
      status:
        workingEvent.status ??
        existingNode?.status ??
        (workingEvent.type === "error" || workingEvent.type === "parser_error"
          ? "error"
          : "success"),
      children: existingNode?.children ?? [],
      links,
      depth,
      toolName: workingEvent.toolName || existingNode?.toolName,
      subagentId: workingEvent.subagentId || existingNode?.subagentId,
      meta: {
        ...existingNode?.meta,
        ...workingEvent.meta,
        ...(workingEvent.path ? { path: workingEvent.path } : {}),
      },
    });
  }

  if (
    workingEvent.type === "tool_result" &&
    resolvedParent &&
    ws.nodes[resolvedParent]
  ) {
    ws.nodes[resolvedParent] = {
      ...ws.nodes[resolvedParent],
      status: workingEvent.status === "error" ? "error" : "success",
      durationMs: workingEvent.durationMs,
    };
  }

  // Track streaming coalesce targets
  const nodeType = ws.nodes[nodeId]?.type;
  if (nodeType === "thinking" || nodeType === "reasoning") {
    ws.latestThoughtId = nodeId;
  }
  if (nodeType === "tool_call" || workingEvent.type === "tool_call") {
    ws.latestToolCallId = nodeId;
  }

  ws.expanded.add(nodeId);
  if (resolvedParent) ws.expanded.add(resolvedParent);
  ws.selectedTraceId = nodeId;

  if (
    ws.status === "idle" ||
    ws.status === "starting" ||
    ws.status === "ready"
  ) {
    ws.status = "running";
  }
  ws.updatedAt = Date.now();
  pushLog(ws, workingEvent);

  if (!ws.metrics.startedAt) {
    ws.metrics = { ...ws.metrics, startedAt: workingEvent.timestamp };
  }

  const providerTokens = extractProviderTokens(workingEvent.meta);
  if (providerTokens != null) {
    ws.metrics = mergeTokensIntoMetrics(ws.metrics, providerTokens);
  }

  ws.metricsDirty = true;
}

function freezeWorkState(
  session: Session,
  ws: WorkState,
  recomputeMetrics: boolean
): ReduceResult {
  const fileTree = ws.filesDirty
    ? buildFileTree(Object.values(ws.files))
    : session.fileTree;

  let next: Session = {
    ...session,
    status: ws.status,
    metrics: ws.metrics,
    nodes: ws.nodes,
    files: ws.files,
    fileTree,
    rootTraceIds: ws.rootTraceIds,
    selectedTraceId: ws.selectedTraceId,
    selectedFileId: ws.selectedFileId,
    updatedAt: ws.updatedAt,
    eventLog: ws.eventLog,
    eventCount: ws.eventCount,
  };

  if (recomputeMetrics && ws.metricsDirty) {
    next = {
      ...next,
      metrics: recomputeSessionMetrics(next),
    };
  }

  return {
    session: next,
    expandedNodeIds: ws.expanded,
    linkedHighlightFileId: ws.linkedHighlightFileId,
    metricsDirty: ws.metricsDirty,
  };
}

/**
 * Apply a single already-stamped stream event.
 * Does not run full metrics recompute (caller flushes once per batch).
 */
export function reduceStreamEvent(
  session: Session,
  expandedNodeIds: Set<string>,
  event: StreamEvent
): ReduceResult {
  const ws = createWorkState(session, expandedNodeIds);
  applyEventToWork(ws, event);
  return freezeWorkState(session, ws, false);
}

/**
 * Apply many stamped events; recomputes metrics once at the end.
 * Clones session collections once, mutates for the batch, freezes once.
 */
export function reduceStreamEvents(
  session: Session,
  expandedNodeIds: Set<string>,
  events: StreamEvent[]
): ReduceResult {
  if (events.length === 0) {
    return {
      session,
      expandedNodeIds,
      metricsDirty: false,
    };
  }

  const ws = createWorkState(session, expandedNodeIds);
  for (const event of events) {
    applyEventToWork(ws, event);
  }
  return freezeWorkState(session, ws, true);
}
