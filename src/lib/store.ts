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
  return {
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
    ...partial,
  };
}

function recomputeMetrics(session: Session): SessionMetrics {
  const nodes = Object.values(session.nodes);
  const files = Object.values(session.files);
  const startedAt = session.metrics.startedAt ?? session.createdAt;
  const endedAt =
    session.status === "completed" || session.status === "error" || session.status === "stopped"
      ? session.metrics.endedAt ?? session.updatedAt
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
}

export const useSpokStore = create<SpokState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  viewMode: "unified",
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
          const existing = Object.values(files).find((f) => f.path === event.path);
          const fd = createFileDiff({
            path: event.path,
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
          if (event.id) {
            if (!fd.relatedTraceIds.includes(event.id)) {
              fd.relatedTraceIds.push(event.id);
            }
          }
          files[fd.id] = fd;
          selectedFileId = fd.id;

          // Also create a trace node for the change
          const nodeId = event.id || nanoid(10);
          const parentId =
            event.parentId ??
            (session.selectedTraceId && nodes[session.selectedTraceId]
              ? session.selectedTraceId
              : rootTraceIds[rootTraceIds.length - 1] ?? null);
          const depth = parentId && nodes[parentId] ? nodes[parentId].depth + 1 : 0;
          const node: TraceNode = {
            id: nodeId,
            parentId,
            type: "file_change",
            title: event.title || `File: ${event.path}`,
            content: event.content || `${event.diffStatus ?? "modified"} ${event.path}`,
            timestamp: event.timestamp,
            status: "success",
            children: [],
            links: [
              {
                kind: "file",
                targetId: fd.id,
                path: event.path,
                label: event.path,
              },
            ],
            depth,
            meta: event.meta,
          };
          nodes[nodeId] = node;
          if (!parentId) rootTraceIds.push(nodeId);
          else attachChild(nodes, parentId, nodeId);
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
            status: session.status === "idle" ? "running" : session.status,
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

      // Generic trace node
      const nodeId = event.id || nanoid(10);
      const parentId =
        event.parentId ??
        (session.selectedTraceId && nodes[session.selectedTraceId]
          ? null // don't auto-nest everything under selected
          : null);

      // Prefer nesting tool results under last tool call
      let resolvedParent = parentId;
      if (event.type === "tool_result") {
        const toolCalls = Object.values(nodes)
          .filter((n) => n.type === "tool_call")
          .sort((a, b) => b.timestamp - a.timestamp);
        if (toolCalls[0]) resolvedParent = toolCalls[0].id;
      }
      if (
        !resolvedParent &&
        (event.type === "thinking" ||
          event.type === "tool_call" ||
          event.type === "plan" ||
          event.type === "subagent_start")
      ) {
        // attach under latest root-ish running node if any
        const lastRoot = rootTraceIds[rootTraceIds.length - 1];
        if (lastRoot && nodes[lastRoot]?.type === "goal") {
          resolvedParent = lastRoot;
        }
      }

      const depth =
        resolvedParent && nodes[resolvedParent] ? nodes[resolvedParent].depth + 1 : 0;

      const links = [...(event.links ?? [])];
      const paths = extractPaths(event.content || "");
      for (const p of paths) {
        const f = Object.values(files).find((x) => x.path === p || x.path.endsWith(p));
        if (f) {
          links.push({ kind: "file", targetId: f.id, path: f.path, label: f.path });
          if (!f.relatedTraceIds.includes(nodeId)) {
            files[f.id] = {
              ...f,
              relatedTraceIds: [...f.relatedTraceIds, nodeId],
            };
          }
        }
      }

      const node: TraceNode = {
        id: nodeId,
        parentId: resolvedParent,
        type: streamEventToNodeType(event.type),
        title: event.title || event.type,
        content: event.content || "",
        summary: event.content ? event.content.slice(0, 120) : undefined,
        timestamp: event.timestamp,
        durationMs: event.durationMs,
        status: event.status ?? (event.type === "error" ? "error" : "success"),
        children: [],
        links,
        depth,
        toolName: event.toolName,
        subagentId: event.subagentId,
        meta: event.meta,
      };

      // Mark parent tool_call success when result arrives
      if (event.type === "tool_result" && resolvedParent && nodes[resolvedParent]) {
        nodes[resolvedParent] = {
          ...nodes[resolvedParent],
          status: event.status === "error" ? "error" : "success",
          durationMs: event.durationMs,
        };
      }

      nodes[nodeId] = node;
      if (!resolvedParent) rootTraceIds.push(nodeId);
      else attachChild(nodes, resolvedParent, nodeId);
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
          session.status === "idle" || session.status === "starting"
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
    const withId = { ...session, id };
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
}));
