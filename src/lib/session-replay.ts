import type { Session, SessionConfig, StreamEvent } from "./types";
import { buildFileTree, createFileDiff } from "./diff-utils";
import { streamEventToNodeType, extractPaths } from "./parser";
import { nanoid } from "nanoid";
import { mergeStreamingText, preferFullerText } from "./trace-text";

/**
 * Pure (non-Zustand) session materializer for replay/import/tests.
 * Mirrors the reducer rules in `store.applyStreamEvent` so disk logs and
 * exports rebuild the same trace/diff state.
 */

function emptyMetrics() {
  return {
    startedAt: null as number | null,
    endedAt: null as number | null,
    elapsedMs: 0,
    toolCallCount: 0,
    thinkingSteps: 0,
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    subagentCount: 0,
    errorCount: 0,
  };
}

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function recomputeMetrics(session: Session) {
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
  };
}

export type ReplaySeed = {
  id: string;
  name?: string;
  source?: Session["source"];
  config?: Partial<SessionConfig>;
  createdAt?: number;
  grokFlags?: Record<string, unknown>;
  promptHistory?: Session["promptHistory"];
  status?: Session["status"];
};

export function createEmptySession(seed: ReplaySeed): Session {
  const now = seed.createdAt ?? Date.now();
  return {
    id: seed.id,
    name: seed.name ?? `Session ${new Date(now).toLocaleString()}`,
    status: seed.status ?? "idle",
    createdAt: now,
    updatedAt: now,
    config: {
      cwd: "",
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
      ...seed.config,
    },
    metrics: emptyMetrics(),
    rootTraceIds: [],
    nodes: {},
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: seed.source ?? "import",
    promptHistory: seed.promptHistory ?? [],
    grokFlags: seed.grokFlags,
  };
}

function attachChild(
  nodes: Session["nodes"],
  parentId: string | null,
  childId: string
) {
  if (!parentId || !nodes[parentId]) return;
  if (!nodes[parentId].children.includes(childId)) {
    nodes[parentId].children = [...nodes[parentId].children, childId];
  }
}

function upsertNode(
  nodes: Session["nodes"],
  rootTraceIds: string[],
  node: Session["nodes"][string]
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

/** Apply a single stream event onto a session (mutates and returns session). */
export function applyEventToSession(
  session: Session,
  event: StreamEvent
): Session {
  const nodes = { ...session.nodes };
  const files = { ...session.files };
  const rootTraceIds = [...session.rootTraceIds];
  let selectedFileId = session.selectedFileId;
  let selectedTraceId = session.selectedTraceId;
  let status = session.status;

  if (event.type === "session_start") {
    return {
      ...session,
      status: "running",
      metrics: { ...session.metrics, startedAt: event.timestamp },
      updatedAt: Date.now(),
    };
  }

  if (event.type === "session_end") {
    const next: Session = {
      ...session,
      status: event.status === "error" ? "error" : "completed",
      metrics: {
        ...session.metrics,
        endedAt: event.timestamp,
      },
      updatedAt: Date.now(),
    };
    next.metrics = recomputeMetrics(next);
    return next;
  }

  if (event.type === "file_change" || event.type === "diff") {
    if (event.path) {
      const path = normalizeRepoPath(event.path);
      const existing = Object.values(files).find(
        (f) => normalizeRepoPath(f.path) === path || f.path.endsWith(path)
      );
      const fd = createFileDiff({
        path: existing?.path ?? path,
        oldPath: event.oldPath,
        oldContent: event.oldContent ?? existing?.oldContent ?? "",
        newContent: event.newContent ?? existing?.newContent ?? "",
        status: event.diffStatus,
        relatedTraceIds: existing?.relatedTraceIds ?? [],
        timestamp: event.timestamp,
      });
      if (existing) {
        fd.id = existing.id;
        fd.relatedTraceIds = [...existing.relatedTraceIds];
      }
      if (event.id && !fd.relatedTraceIds.includes(event.id)) {
        fd.relatedTraceIds.push(event.id);
      }
      files[fd.id] = fd;
      selectedFileId = fd.id;

      const nodeId = event.id || nanoid(10);
      const prev = nodes[nodeId];
      const parentId = event.parentId ?? prev?.parentId ?? null;
      const depth = parentId && nodes[parentId] ? nodes[parentId].depth + 1 : 0;
      upsertNode(nodes, rootTraceIds, {
        id: nodeId,
        parentId,
        type: "file_change",
        title: event.title || `File: ${path}`,
        content: event.content || `${event.diffStatus ?? "modified"} ${path}`,
        summary: path,
        timestamp: event.timestamp,
        status: "success",
        children: prev?.children ?? [],
        links: [{ kind: "file", targetId: fd.id, path, label: path }],
        depth,
        meta: event.meta,
      });
      selectedTraceId = nodeId;
      if (status === "idle" || status === "ready") status = "running";

      const next: Session = {
        ...session,
        nodes,
        files,
        fileTree: buildFileTree(Object.values(files)),
        rootTraceIds,
        selectedFileId,
        selectedTraceId,
        status,
        updatedAt: Date.now(),
      };
      next.metrics = recomputeMetrics(next);
      return next;
    }
  }

  let nodeId = event.id || nanoid(10);
  let existingNode = nodes[nodeId];
  let eventContent = event.content;
  let resolvedParent = event.parentId ?? existingNode?.parentId ?? null;

  if (event.type === "tool_result" && !resolvedParent) {
    const toolCallId = event.meta?.toolCallId as string | undefined;
    if (toolCallId) {
      const match = Object.values(nodes).find(
        (n) => n.meta?.toolCallId === toolCallId || n.id === toolCallId
      );
      if (match) resolvedParent = match.id;
    }
  }

  const depth =
    resolvedParent && nodes[resolvedParent]
      ? nodes[resolvedParent].depth + 1
      : (existingNode?.depth ?? 0);

  const links = [...(event.links ?? existingNode?.links ?? [])];
  const paths = extractPaths(event.content || "");
  for (const p of paths) {
    const f = Object.values(files).find(
      (x) =>
        normalizeRepoPath(x.path) === normalizeRepoPath(p) || x.path.endsWith(p)
    );
    if (f && !links.some((l) => l.targetId === f.id)) {
      links.push({ kind: "file", targetId: f.id, path: f.path, label: f.path });
      if (!f.relatedTraceIds.includes(nodeId)) {
        files[f.id] = {
          ...f,
          relatedTraceIds: [...f.relatedTraceIds, nodeId],
        };
      }
    }
  }

  if (event.type === "tool_result" && existingNode?.type === "tool_call") {
    upsertNode(nodes, rootTraceIds, {
      ...existingNode,
      type: "tool_call",
      title: event.title || existingNode.title,
      content: event.content || existingNode.content,
      summary: event.summary
        || (event.content
          ? event.content.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 160)
          : existingNode.summary),
      timestamp: existingNode.timestamp,
      durationMs: event.durationMs,
      status: event.status ?? "success",
      children: existingNode.children,
      links,
      depth: existingNode.depth,
      toolName: event.toolName || existingNode.toolName,
      meta: { ...existingNode.meta, ...event.meta },
    });
  } else {
    const isProse =
      event.type === "thinking" ||
      event.type === "reasoning" ||
      event.type === "message" ||
      event.type === "plan" ||
      event.type === "plan_update";
    // Fold short thinking fragments into the latest thought node
    if (
      (event.type === "thinking" || event.type === "reasoning") &&
      !existingNode
    ) {
      const latestThought = Object.values(nodes)
        .filter((n) => n.type === "thinking" || n.type === "reasoning")
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      if (latestThought) {
        const folded = mergeStreamingText(
          latestThought.content || "",
          eventContent || ""
        );
        nodeId = latestThought.id;
        existingNode = latestThought;
        eventContent = preferFullerText(folded, eventContent);
      }
    }
    const nextContent = isProse
      ? preferFullerText(
          mergeStreamingText(existingNode?.content || "", eventContent || ""),
          preferFullerText(eventContent, existingNode?.content)
        )
      : eventContent !== undefined && eventContent !== ""
        ? eventContent
        : existingNode?.content || "";
    const nextSummary = isProse
      ? preferFullerText(
          event.summary ||
            (nextContent
              ? nextContent.replace(/\s+/g, " ").trim().slice(0, 160)
              : undefined),
          existingNode?.summary
        )
      : event.summary ||
        (nextContent
          ? nextContent.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 160)
          : undefined) ||
        existingNode?.summary;

    upsertNode(nodes, rootTraceIds, {
      id: nodeId,
      parentId: resolvedParent,
      type: streamEventToNodeType(event.type),
      title: event.title || existingNode?.title || event.type,
      content: nextContent,
      summary: nextSummary,
      timestamp: existingNode?.timestamp ?? event.timestamp,
      durationMs: event.durationMs ?? existingNode?.durationMs,
      status:
        event.status ??
        existingNode?.status ??
        (event.type === "error" || event.type === "parser_error"
          ? "error"
          : "success"),
      children: existingNode?.children ?? [],
      links,
      depth,
      toolName: event.toolName || existingNode?.toolName,
      subagentId: event.subagentId || existingNode?.subagentId,
      meta: {
        ...existingNode?.meta,
        ...event.meta,
        ...(event.path ? { path: event.path } : {}),
      },
    });
  }

  selectedTraceId = nodeId;
  if (status === "idle" || status === "starting" || status === "ready") {
    status = "running";
  }

  const next: Session = {
    ...session,
    nodes,
    files,
    fileTree: buildFileTree(Object.values(files)),
    rootTraceIds,
    selectedTraceId,
    selectedFileId,
    status,
    updatedAt: Date.now(),
  };
  if (!next.metrics.startedAt) {
    next.metrics = { ...next.metrics, startedAt: event.timestamp };
  }
  next.metrics = recomputeMetrics(next);
  return next;
}

/**
 * Rebuild a full Session from an ordered event log.
 * Every rendered trace node is produced by applying events in order.
 */
export function replayEvents(
  events: StreamEvent[],
  seed: ReplaySeed
): Session {
  let session = createEmptySession(seed);
  for (const event of events) {
    session = applyEventToSession(session, event);
  }
  // After replay, idle/running-from-partial should settle to ready/completed
  if (session.status === "running" || session.status === "starting") {
    session = {
      ...session,
      status: seed.status && seed.status !== "running" ? seed.status : "ready",
      updatedAt: Date.now(),
    };
    session.metrics = recomputeMetrics(session);
  }
  return session;
}

/**
 * Best-effort reconstruction of events from a v1 snapshot that has nodes but no event log.
 * Used for migration when importing older exports.
 */
export function eventsFromSnapshotNodes(session: Session): StreamEvent[] {
  const nodes = Object.values(session.nodes).sort(
    (a, b) => a.timestamp - b.timestamp
  );
  const events: StreamEvent[] = [];
  for (const n of nodes) {
    const type =
      n.type === "file_change"
        ? "file_change"
        : n.type === "tool_call"
          ? "tool_call"
          : n.type === "tool_result"
            ? "tool_result"
            : n.type === "thinking" || n.type === "reasoning"
              ? n.type
              : n.type === "error"
                ? "error"
                : n.type === "goal"
                  ? "goal"
                  : n.type === "plan" || n.type === "plan_update"
                    ? "plan"
                    : n.type === "subagent"
                      ? "subagent_start"
                      : n.type === "system"
                        ? "system"
                        : "message";

    const fileLink = n.links.find((l) => l.kind === "file");
    const file = fileLink ? session.files[fileLink.targetId] : undefined;

    events.push({
      version: 1,
      type,
      timestamp: n.timestamp,
      id: n.id,
      parentId: n.parentId,
      title: n.title,
      content: n.content,
      summary: n.summary,
      status: n.status,
      toolName: n.toolName,
      subagentId: n.subagentId,
      durationMs: n.durationMs,
      path: file?.path ?? fileLink?.path,
      oldContent: file?.oldContent,
      newContent: file?.newContent,
      diffStatus: file?.status,
      meta: { ...n.meta, recoveredFromSnapshot: true },
      links: n.links,
      provider: "import",
      sessionId: session.id,
    });
  }
  return events;
}
