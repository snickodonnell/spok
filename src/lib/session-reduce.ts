/**
 * Pure session stream reducer — shared by the Zustand store and batch ingest.
 * Applies one stamped StreamEvent to session + expanded-node set without
 * touching React/Zustand. Callers recompute metrics once per batch flush.
 */

import { nanoid } from "nanoid";
import type { Session, StreamEvent, TraceNode } from "./types";
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
  const MAX_MEM = 8_000;
  const nextLog =
    prevLog.length >= MAX_MEM
      ? [...prevLog.slice(prevLog.length - MAX_MEM + 1), stamped]
      : [...prevLog, stamped];
  return {
    ...session,
    eventLog: nextLog,
    eventCount: (session.eventCount ?? prevLog.length) + 1,
  };
}

export function recomputeSessionMetrics(session: Session) {
  const nodes = Object.values(session.nodes);
  const files = Object.values(session.files);
  const startedAt = session.metrics.startedAt ?? session.createdAt;
  const endedAt =
    session.status === "completed" ||
    session.status === "error" ||
    session.status === "stopped" ||
    session.status === "ready"
      ? session.metrics.endedAt
      : null;
  const tokensEstimate = session.metrics.tokensEstimate;
  const tokensLimit = session.metrics.tokensLimit;
  return {
    startedAt,
    endedAt,
    elapsedMs: (endedAt ?? Date.now()) - startedAt,
    toolCallCount: nodes.filter((n) => n.type === "tool_call").length,
    thinkingSteps: nodes.filter(
      (n) => n.type === "thinking" || n.type === "reasoning"
    ).length,
    filesChanged: files.length,
    linesAdded: files.reduce((s, f) => s + f.additions, 0),
    linesDeleted: files.reduce((s, f) => s + f.deletions, 0),
    subagentCount: nodes.filter((n) => n.type === "subagent").length,
    errorCount: nodes.filter((n) => n.type === "error" || n.status === "error")
      .length,
    tokensEstimate,
    tokensLimit,
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
  let expanded = expandedNodeIds;
  let linkedHighlightFileId: string | null | undefined;

  if (event.type === "session_start") {
    const updated = appendEventLog(
      {
        ...session,
        status: "running",
        metrics: { ...session.metrics, startedAt: event.timestamp },
        updatedAt: Date.now(),
      },
      event
    );
    return {
      session: updated,
      expandedNodeIds: expanded,
      metricsDirty: true,
    };
  }

  if (event.type === "session_end") {
    const updated = appendEventLog(
      {
        ...session,
        status: event.status === "error" ? "error" : "completed",
        metrics: {
          ...session.metrics,
          endedAt: event.timestamp,
        },
        updatedAt: Date.now(),
      },
      event
    );
    return {
      session: updated,
      expandedNodeIds: expanded,
      metricsDirty: true,
    };
  }

  const nodes = { ...session.nodes };
  const files = { ...session.files };
  const rootTraceIds = [...session.rootTraceIds];
  let selectedFileId = session.selectedFileId;
  let workingEvent = event;

  // File / diff events
  if (
    (workingEvent.type === "file_change" || workingEvent.type === "diff") &&
    workingEvent.path
  ) {
    const path = normalizeRepoPath(workingEvent.path);
    const existing = Object.values(files).find(
      (f) => normalizeRepoPath(f.path) === path || f.path.endsWith(path)
    );
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
    files[fd.id] = fd;
    selectedFileId = fd.id;

    const nodeId = workingEvent.id || nanoid(10);
    const prev = nodes[nodeId];
    const parentId = workingEvent.parentId ?? prev?.parentId ?? null;
    const depth =
      parentId && nodes[parentId] ? nodes[parentId].depth + 1 : 0;
    upsertNode(nodes, rootTraceIds, {
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
    expanded = new Set(expanded);
    expanded.add(nodeId);
    if (parentId) expanded.add(parentId);
    linkedHighlightFileId = fd.id;

    const fileTree = buildFileTree(Object.values(files));
    let updated = appendEventLog(
      {
        ...session,
        nodes,
        files,
        fileTree,
        rootTraceIds,
        selectedFileId,
        selectedTraceId: nodeId,
        status:
          session.status === "idle" || session.status === "ready"
            ? "running"
            : session.status,
        updatedAt: Date.now(),
        metrics: session.metrics,
      },
      workingEvent
    );
    return {
      session: updated,
      expandedNodeIds: expanded,
      linkedHighlightFileId,
      metricsDirty: true,
    };
  }

  // Generic trace node (upsert by id for chunk coalescing)
  let nodeId = workingEvent.id || nanoid(10);
  let existingNode = nodes[nodeId];
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
      const latestThought = Object.values(nodes)
        .filter((n) => n.type === "thinking" || n.type === "reasoning")
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      if (latestThought) {
        const prev = latestThought.content || "";
        const sameId = !!workingEvent.id && workingEvent.id === latestThought.id;
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
      const match = Object.values(nodes).find(
        (n) => n.meta?.toolCallId === toolCallId || n.id === toolCallId
      );
      if (match) resolvedParent = match.id;
    }
    if (!resolvedParent) {
      const toolCalls = Object.values(nodes)
        .filter((n) => n.type === "tool_call")
        .sort((a, b) => b.timestamp - a.timestamp);
      if (toolCalls[0]) resolvedParent = toolCalls[0].id;
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
    const lastRoot = rootTraceIds[rootTraceIds.length - 1];
    if (lastRoot && nodes[lastRoot]?.type === "goal") {
      resolvedParent = lastRoot;
    }
  }

  const depth =
    resolvedParent && nodes[resolvedParent]
      ? nodes[resolvedParent].depth + 1
      : (existingNode?.depth ?? 0);

  const links = [...(workingEvent.links ?? existingNode?.links ?? [])];
  const paths = extractPaths(workingEvent.content || "");
  const bareFile = workingEvent.path
    ? [workingEvent.path]
    : (workingEvent.content || "").match(
        /(?:^|[\s`"'])([a-zA-Z0-9_.-]+\.(?:md|ts|tsx|js|json|py|rs|go|css|html))\b/g
      ) ?? [];
  for (const p of [...paths, ...bareFile.map((x) => x.trim())]) {
    const clean = p.replace(/^[\s`"']+/, "");
    const f = Object.values(files).find(
      (x) =>
        normalizeRepoPath(x.path) === normalizeRepoPath(clean) ||
        x.path.endsWith(clean)
    );
    if (f && !links.some((l) => l.targetId === f.id)) {
      links.push({
        kind: "file",
        targetId: f.id,
        path: f.path,
        label: f.path,
      });
      if (!f.relatedTraceIds.includes(nodeId)) {
        files[f.id] = {
          ...f,
          relatedTraceIds: [...f.relatedTraceIds, nodeId],
        };
      }
    }
  }

  if (
    workingEvent.type === "tool_result" &&
    existingNode?.type === "tool_call"
  ) {
    upsertNode(nodes, rootTraceIds, {
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

    upsertNode(nodes, rootTraceIds, {
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
    nodes[resolvedParent]
  ) {
    nodes[resolvedParent] = {
      ...nodes[resolvedParent],
      status: workingEvent.status === "error" ? "error" : "success",
      durationMs: workingEvent.durationMs,
    };
  }

  expanded = new Set(expanded);
  expanded.add(nodeId);
  if (resolvedParent) expanded.add(resolvedParent);

  const fileTree = buildFileTree(Object.values(files));
  let updated = appendEventLog(
    {
      ...session,
      nodes,
      files,
      fileTree,
      rootTraceIds,
      selectedTraceId: nodeId,
      selectedFileId,
      status:
        session.status === "idle" ||
        session.status === "starting" ||
        session.status === "ready"
          ? "running"
          : session.status,
      updatedAt: Date.now(),
      metrics: session.metrics,
    },
    workingEvent
  );

  if (!updated.metrics.startedAt) {
    updated = {
      ...updated,
      metrics: { ...updated.metrics, startedAt: workingEvent.timestamp },
    };
  }

  const providerTokens = extractProviderTokens(workingEvent.meta);
  if (providerTokens != null) {
    updated = {
      ...updated,
      metrics: mergeTokensIntoMetrics(updated.metrics, providerTokens),
    };
  }

  return {
    session: updated,
    expandedNodeIds: expanded,
    metricsDirty: true,
  };
}

/**
 * Apply many stamped events; recomputes metrics once at the end.
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

  let current = session;
  let expanded = expandedNodeIds;
  let linkedHighlightFileId: string | null | undefined;
  let metricsDirty = false;

  for (const event of events) {
    const result = reduceStreamEvent(current, expanded, event);
    current = result.session;
    expanded = result.expandedNodeIds;
    if (result.linkedHighlightFileId !== undefined) {
      linkedHighlightFileId = result.linkedHighlightFileId;
    }
    metricsDirty = metricsDirty || result.metricsDirty;
  }

  if (metricsDirty) {
    current = {
      ...current,
      metrics: recomputeSessionMetrics(current),
    };
  }

  return {
    session: current,
    expandedNodeIds: expanded,
    linkedHighlightFileId,
    metricsDirty,
  };
}
