"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  FileDiff,
  Session,
  SessionConfig,
  SessionMetrics,
  StreamEvent,
  TraceFilter,
  TraceNode,
  ViewMode,
} from "./types";
import { buildFileTree, createFileDiff } from "./diff-utils";
import { streamEventToNodeType, extractPaths } from "./parser";

const defaultConfig: SessionConfig = {
  cwd: "",
  command: "grok",
  args: [],
  autoScroll: true,
  playbackSpeed: 1,
};

function emptyMetrics(): SessionMetrics {
  return {
    startedAt: null,
    endedAt: null,
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

function createSession(partial?: Partial<Session>): Session {
  const now = Date.now();
  const base: Session = {
    id: nanoid(12),
    name: partial?.name ?? `Session ${new Date(now).toLocaleString()}`,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    config: { ...defaultConfig, ...partial?.config },
    metrics: emptyMetrics(),
    rootTraceIds: [],
    nodes: {},
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: partial?.source ?? "live",
    promptHistory: [],
  };
  return {
    ...base,
    ...partial,
    config: { ...defaultConfig, ...partial?.config },
    promptHistory: partial?.promptHistory ?? [],
  };
}

function recomputeMetrics(session: Session): SessionMetrics {
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
    thinkingSteps: nodes.filter((n) => n.type === "thinking" || n.type === "reasoning").length,
    filesChanged: files.length,
    linesAdded: files.reduce((s, f) => s + f.additions, 0),
    linesDeleted: files.reduce((s, f) => s + f.deletions, 0),
    subagentCount: nodes.filter((n) => n.type === "subagent").length,
    errorCount: nodes.filter((n) => n.type === "error" || n.status === "error").length,
  };
}

function attachChild(nodes: Record<string, TraceNode>, parentId: string | null, childId: string) {
  if (!parentId || !nodes[parentId]) return;
  if (!nodes[parentId].children.includes(childId)) {
    nodes[parentId].children = [...nodes[parentId].children, childId];
  }
}

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/** Upsert a trace node; preserves children when updating an existing id */
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
      // Keep parent unless explicitly re-parented
      parentId: node.parentId ?? existing.parentId,
      depth: node.parentId
        ? node.depth
        : existing.depth,
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

interface SpokState {
  sessions: Record<string, Session>;
  activeSessionId: string | null;
  viewMode: ViewMode;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  importOpen: boolean;
  launchOpen: boolean;
  traceFilter: TraceFilter;
  expandedNodeIds: Set<string>;
  linkedHighlightFileId: string | null;
  crtEnabled: boolean;
  scanlines: boolean;

  // selectors helpers
  getActiveSession: () => Session | null;

  // actions
  setViewMode: (mode: ViewMode) => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  setLaunchOpen: (open: boolean) => void;
  setTraceFilter: (filter: Partial<TraceFilter>) => void;
  toggleExpanded: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setCrtEnabled: (v: boolean) => void;
  setScanlines: (v: boolean) => void;

  createSession: (partial?: Partial<Session>) => string;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<Session>) => void;
  deleteSession: (id: string) => void;

  applyStreamEvent: (sessionId: string, event: StreamEvent) => void;
  applyStreamEvents: (sessionId: string, events: StreamEvent[]) => void;
  appendRawLog: (sessionId: string, line: string) => void;

  selectTrace: (id: string | null) => void;
  selectFile: (id: string | null) => void;
  setTimelineCursor: (ts: number | null) => void;
  linkTraceToFile: (traceId: string, fileId: string) => void;
  navigateTraceLink: (traceId: string) => void;

  importSession: (session: Session) => string;
  exportActiveSession: () => Session | null;
  upsertFileDiff: (sessionId: string, file: FileDiff, relatedTraceId?: string) => void;
  pushPromptTurn: (sessionId: string, turn: import("./types").PromptTurn) => void;
  updatePromptTurn: (
    sessionId: string,
    turnId: string,
    patch: Partial<import("./types").PromptTurn>
  ) => void;
  clearSessionTraces: (sessionId: string) => void;
  setGrokFlags: (sessionId: string, flags: Record<string, unknown>) => void;
}

export const useSpokStore = create<SpokState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  viewMode: "workspace",
  sidebarOpen: true,
  commandPaletteOpen: false,
  importOpen: false,
  launchOpen: false,
  traceFilter: {
    search: "",
    types: [],
    status: [],
    showOnlyLinked: false,
  },
  expandedNodeIds: new Set(),
  linkedHighlightFileId: null,
  crtEnabled: true,
  scanlines: true,

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return null;
    return sessions[activeSessionId] ?? null;
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setImportOpen: (open) => set({ importOpen: open }),
  setLaunchOpen: (open) => set({ launchOpen: open }),
  setTraceFilter: (filter) =>
    set((s) => ({ traceFilter: { ...s.traceFilter, ...filter } })),
  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedNodeIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedNodeIds: next };
    }),
  expandAll: () =>
    set((s) => {
      const session = s.activeSessionId ? s.sessions[s.activeSessionId] : null;
      if (!session) return s;
      return { expandedNodeIds: new Set(Object.keys(session.nodes)) };
    }),
  collapseAll: () => set({ expandedNodeIds: new Set() }),
  setCrtEnabled: (v) => set({ crtEnabled: v }),
  setScanlines: (v) => set({ scanlines: v }),

  createSession: (partial) => {
    const session = createSession(partial);
    set((s) => ({
      sessions: { ...s.sessions, [session.id]: session },
      activeSessionId: session.id,
      expandedNodeIds: new Set(),
    }));
    return session.id;
  },

  setActiveSession: (id) => set({ activeSessionId: id, expandedNodeIds: new Set() }),

  updateSession: (id, patch) =>
    set((s) => {
      const prev = s.sessions[id];
      if (!prev) return s;
      const next = { ...prev, ...patch, updatedAt: Date.now() };
      return { sessions: { ...s.sessions, [id]: next } };
    }),

  deleteSession: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.sessions;
      void _removed;
      return {
        sessions: rest,
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      };
    }),

  applyStreamEvent: (sessionId, event) => {
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;

      const nodes = { ...session.nodes };
      const files = { ...session.files };
      const rootTraceIds = [...session.rootTraceIds];
      let selectedFileId = session.selectedFileId;
      const expanded = new Set(s.expandedNodeIds);

      if (event.type === "session_start") {
        const updated: Session = {
          ...session,
          status: "running",
          metrics: { ...session.metrics, startedAt: event.timestamp },
          updatedAt: Date.now(),
        };
        return {
          sessions: { ...s.sessions, [sessionId]: updated },
        };
      }

      if (event.type === "session_end") {
        const updated: Session = {
          ...session,
          status: event.status === "error" ? "error" : "completed",
          metrics: {
            ...recomputeMetrics(session),
            endedAt: event.timestamp,
          },
          updatedAt: Date.now(),
        };
        updated.metrics = recomputeMetrics(updated);
        return { sessions: { ...s.sessions, [sessionId]: updated } };
      }

      // File / diff events
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
          const parentId =
            event.parentId ??
            prev?.parentId ??
            null;
          const depth = parentId && nodes[parentId] ? nodes[parentId].depth + 1 : 0;
          upsertNode(nodes, rootTraceIds, {
            id: nodeId,
            parentId,
            type: "file_change",
            title: event.title || `File: ${path}`,
            content:
              event.content || `${event.diffStatus ?? "modified"} ${path}`,
            summary: path,
            timestamp: event.timestamp,
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
            meta: event.meta,
          });
          expanded.add(nodeId);
          if (parentId) expanded.add(parentId);

          const fileTree = buildFileTree(Object.values(files));
          const updated: Session = {
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
          };
          updated.metrics = recomputeMetrics(updated);
          return {
            sessions: { ...s.sessions, [sessionId]: updated },
            expandedNodeIds: expanded,
            linkedHighlightFileId: fd.id,
          };
        }
      }

      // Generic trace node (upsert by id for chunk coalescing)
      const nodeId = event.id || nanoid(10);
      const existingNode = nodes[nodeId];

      let resolvedParent = event.parentId ?? existingNode?.parentId ?? null;
      if (event.type === "tool_result" && !resolvedParent) {
        // Prefer explicit id match via meta.toolCallId
        const toolCallId = event.meta?.toolCallId as string | undefined;
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
        (event.type === "thinking" ||
          event.type === "tool_call" ||
          event.type === "plan" ||
          event.type === "subagent_start")
      ) {
        const lastRoot = rootTraceIds[rootTraceIds.length - 1];
        if (lastRoot && nodes[lastRoot]?.type === "goal") {
          resolvedParent = lastRoot;
        }
      }

      const depth =
        resolvedParent && nodes[resolvedParent]
          ? nodes[resolvedParent].depth + 1
          : existingNode?.depth ?? 0;

      const links = [...(event.links ?? existingNode?.links ?? [])];
      const paths = extractPaths(event.content || "");
      // also match bare filenames like plan.md
      const bareFile = event.path
        ? [event.path]
        : (event.content || "").match(
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
          links.push({ kind: "file", targetId: f.id, path: f.path, label: f.path });
          if (!f.relatedTraceIds.includes(nodeId)) {
            files[f.id] = {
              ...f,
              relatedTraceIds: [...f.relatedTraceIds, nodeId],
            };
          }
        }
      }

      // tool_call update with same id as tool_result: update status on same node
      if (event.type === "tool_result" && existingNode?.type === "tool_call") {
        upsertNode(nodes, rootTraceIds, {
          ...existingNode,
          type: "tool_call",
          title: event.title || existingNode.title,
          content: event.content || existingNode.content,
          summary: event.content
            ? event.content.slice(0, 120)
            : existingNode.summary,
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
        upsertNode(nodes, rootTraceIds, {
          id: nodeId,
          parentId: resolvedParent,
          type: streamEventToNodeType(event.type),
          title: event.title || event.type,
          content: event.content || "",
          summary: event.summary || (event.content ? event.content.slice(0, 120) : undefined),
          timestamp: existingNode?.timestamp ?? event.timestamp,
          durationMs: event.durationMs,
          status: event.status ?? (event.type === "error" ? "error" : "success"),
          children: existingNode?.children ?? [],
          links,
          depth,
          toolName: event.toolName,
          subagentId: event.subagentId,
          meta: event.meta,
        });
      }

      if (event.type === "tool_result" && resolvedParent && nodes[resolvedParent]) {
        nodes[resolvedParent] = {
          ...nodes[resolvedParent],
          status: event.status === "error" ? "error" : "success",
          durationMs: event.durationMs,
        };
      }

      expanded.add(nodeId);
      if (resolvedParent) expanded.add(resolvedParent);

      const fileTree = buildFileTree(Object.values(files));
      const updated: Session = {
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
      };
      if (!updated.metrics.startedAt) {
        updated.metrics = { ...updated.metrics, startedAt: event.timestamp };
      }
      updated.metrics = recomputeMetrics(updated);

      return {
        sessions: { ...s.sessions, [sessionId]: updated },
        expandedNodeIds: expanded,
      };
    });
  },

  applyStreamEvents: (sessionId, events) => {
    for (const e of events) {
      get().applyStreamEvent(sessionId, e);
    }
  },

  appendRawLog: (sessionId, line) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            rawLog: [...session.rawLog, line],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  selectTrace: (id) =>
    set((s) => {
      if (!s.activeSessionId) return s;
      const session = s.sessions[s.activeSessionId];
      if (!session) return s;
      let linkedHighlightFileId = s.linkedHighlightFileId;
      let selectedFileId = session.selectedFileId;
      if (id && session.nodes[id]) {
        const fileLink = session.nodes[id].links.find((l) => l.kind === "file");
        if (fileLink) {
          linkedHighlightFileId = fileLink.targetId;
          selectedFileId = fileLink.targetId;
        }
      }
      return {
        linkedHighlightFileId,
        sessions: {
          ...s.sessions,
          [session.id]: { ...session, selectedTraceId: id, selectedFileId },
        },
      };
    }),

  selectFile: (id) =>
    set((s) => {
      if (!s.activeSessionId) return s;
      const session = s.sessions[s.activeSessionId];
      if (!session) return s;
      let selectedTraceId = session.selectedTraceId;
      if (id && session.files[id]) {
        const related = session.files[id].relatedTraceIds[0];
        if (related) selectedTraceId = related;
      }
      return {
        linkedHighlightFileId: id,
        sessions: {
          ...s.sessions,
          [session.id]: { ...session, selectedFileId: id, selectedTraceId },
        },
      };
    }),

  setTimelineCursor: (ts) =>
    set((s) => {
      if (!s.activeSessionId) return s;
      const session = s.sessions[s.activeSessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [session.id]: { ...session, timelineCursor: ts },
        },
      };
    }),

  linkTraceToFile: (traceId, fileId) =>
    set((s) => {
      if (!s.activeSessionId) return s;
      const session = s.sessions[s.activeSessionId];
      if (!session || !session.nodes[traceId] || !session.files[fileId]) return s;
      const nodes = { ...session.nodes };
      const files = { ...session.files };
      const node = { ...nodes[traceId], links: [...nodes[traceId].links] };
      if (!node.links.some((l) => l.targetId === fileId)) {
        node.links.push({
          kind: "file",
          targetId: fileId,
          path: files[fileId].path,
          label: files[fileId].path,
        });
      }
      nodes[traceId] = node;
      const file = { ...files[fileId] };
      if (!file.relatedTraceIds.includes(traceId)) {
        file.relatedTraceIds = [...file.relatedTraceIds, traceId];
      }
      files[fileId] = file;
      return {
        sessions: { ...s.sessions, [session.id]: { ...session, nodes, files } },
      };
    }),

  navigateTraceLink: (traceId) => {
    get().selectTrace(traceId);
    const session = get().getActiveSession();
    if (!session) return;
    const node = session.nodes[traceId];
    if (!node) return;
    const fileLink = node.links.find((l) => l.kind === "file");
    if (fileLink) {
      get().selectFile(fileLink.targetId);
      get().setViewMode("unified");
    }
  },

  importSession: (session) => {
    const id = session.id || nanoid(12);
    const withId: Session = {
      ...session,
      id,
      promptHistory: session.promptHistory ?? [],
    };
    set((s) => ({
      sessions: { ...s.sessions, [id]: withId },
      activeSessionId: id,
      expandedNodeIds: new Set(Object.keys(withId.nodes)),
    }));
    return id;
  },

  exportActiveSession: () => get().getActiveSession(),

  upsertFileDiff: (sessionId, file, relatedTraceId) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const files = { ...session.files };
      const existing = Object.values(files).find((f) => f.path === file.path);
      const id = existing?.id ?? file.id;
      const related = new Set([
        ...(existing?.relatedTraceIds ?? []),
        ...file.relatedTraceIds,
        ...(relatedTraceId ? [relatedTraceId] : []),
      ]);
      files[id] = { ...file, id, relatedTraceIds: [...related] };
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            files,
            fileTree: buildFileTree(Object.values(files)),
            selectedFileId: id,
            updatedAt: Date.now(),
            metrics: recomputeMetrics({ ...session, files }),
          },
        },
      };
    }),

  pushPromptTurn: (sessionId, turn) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            promptHistory: [...(session.promptHistory ?? []), turn],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  updatePromptTurn: (sessionId, turnId, patch) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            promptHistory: (session.promptHistory ?? []).map((t) =>
              t.id === turnId ? { ...t, ...patch } : t
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearSessionTraces: (sessionId) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            rootTraceIds: [],
            nodes: {},
            files: {},
            fileTree: [],
            selectedTraceId: null,
            selectedFileId: null,
            timelineCursor: null,
            rawLog: [],
            promptHistory: [],
            metrics: emptyMetrics(),
            status: "ready",
            error: undefined,
            updatedAt: Date.now(),
          },
        },
        expandedNodeIds: new Set(),
      };
    }),

  setGrokFlags: (sessionId, flags) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            grokFlags: { ...(session.grokFlags ?? {}), ...flags },
            updatedAt: Date.now(),
          },
        },
      };
    }),
}));
