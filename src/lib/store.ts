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
  ProductMode,
  WorkspaceRightTab,
  LeftTraceMode,
} from "./types";
import { buildFileTree, createFileDiff } from "./diff-utils";
import { streamEventToNodeType, extractPaths } from "./parser";
import { stampStreamEvent } from "./stream-event-schema";
import {
  isNonThoughtContent,
  mergeStreamingText,
  preferFullerText,
} from "./trace-text";
import {
  deleteDurableSession,
  enqueueDurableEvents,
  flushDurableSession,
  registerDurableSession,
  saveDurableSnapshot,
} from "./session-persist-client";
import { extractProviderTokens, mergeTokensIntoMetrics } from "./usage";

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
    eventLog: [],
    durable: partial?.durable ?? partial?.source === "live",
    eventCount: 0,
  };
  return {
    ...base,
    ...partial,
    config: { ...defaultConfig, ...partial?.config },
    promptHistory: partial?.promptHistory ?? [],
    eventLog: partial?.eventLog ?? [],
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
  // Preserve provider-reported token totals across metric recompute
  const tokensEstimate = session.metrics.tokensEstimate;
  const tokensLimit = session.metrics.tokensLimit;
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
    tokensEstimate,
    tokensLimit,
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
  /** Primary product mode: Run / Review / Automate / Extend */
  productMode: ProductMode;
  /** Right pane task tab inside workspace (Changes / Review / Events / Health) */
  workspaceRightTab: WorkspaceRightTab;
  /** Left pane: Thinking prose vs full event graph */
  leftTraceMode: LeftTraceMode;
  /** Causal drawer open for selected file ("Why did this change?") */
  causalDrawerOpen: boolean;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  importOpen: boolean;
  launchOpen: boolean;
  settingsOpen: boolean;
  /** Extension Center dialog */
  extensionsOpen: boolean;
  /** Skill ids attached for the next prompt turn (cleared after submit). */
  selectedSkillIds: string[];
  /** Optional agent preset for the next prompt turn. */
  selectedAgentId: string | null;
  /** App-level permission mode (mirrors resolved settings). */
  appPermissionMode: import("./settings/types").AppPermissionMode;
  traceFilter: TraceFilter;
  expandedNodeIds: Set<string>;
  linkedHighlightFileId: string | null;
  crtEnabled: boolean;
  scanlines: boolean;
  /** Appearance theme: professional | crt | high-contrast */
  uiTheme: import("./theme").UiTheme;
  reducedMotion: boolean;
  osNotifications: boolean;
  nativeFolderPicker: boolean;
  keyboardHelpOpen: boolean;
  diagnosticsOpen: boolean;

  // selectors helpers
  getActiveSession: () => Session | null;

  // actions
  setViewMode: (mode: ViewMode) => void;
  setProductMode: (mode: ProductMode) => void;
  setWorkspaceRightTab: (tab: WorkspaceRightTab) => void;
  setLeftTraceMode: (mode: LeftTraceMode) => void;
  setCausalDrawerOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  setLaunchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setExtensionsOpen: (open: boolean) => void;
  toggleSelectedSkill: (id: string) => void;
  clearSelectedSkills: () => void;
  setSelectedAgentId: (id: string | null) => void;
  setAppPermissionMode: (
    mode: import("./settings/types").AppPermissionMode
  ) => void;
  setTraceFilter: (filter: Partial<TraceFilter>) => void;
  toggleExpanded: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  setCrtEnabled: (v: boolean) => void;
  setScanlines: (v: boolean) => void;
  setUiTheme: (theme: import("./theme").UiTheme) => void;
  setReducedMotion: (v: boolean) => void;
  setOsNotifications: (v: boolean) => void;
  setNativeFolderPicker: (v: boolean) => void;
  setKeyboardHelpOpen: (open: boolean) => void;
  setDiagnosticsOpen: (open: boolean) => void;

  /**
   * Create a session. When `activate` is false, the current active session
   * is preserved (background jobs).
   */
  createSession: (
    partial?: Partial<Session>,
    opts?: { activate?: boolean }
  ) => string;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, patch: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  /** Insert a fully materialised session without re-running events (e.g. resume). */
  hydrateSession: (session: Session, opts?: { activate?: boolean }) => void;
  /** App bootstrap: mark hydration complete */
  setHydrated: (v: boolean) => void;
  hydrated: boolean;
  hydrating: boolean;
  setHydrating: (v: boolean) => void;

  applyStreamEvent: (sessionId: string, event: StreamEvent) => void;
  applyStreamEvents: (sessionId: string, events: StreamEvent[]) => void;
  appendRawLog: (sessionId: string, line: string) => void;
  /** Persist current snapshot to disk (debounced callers may use flush). */
  persistSessionNow: (sessionId: string) => void;

  selectTrace: (id: string | null) => void;
  selectFile: (id: string | null) => void;
  setTimelineCursor: (ts: number | null) => void;
  linkTraceToFile: (traceId: string, fileId: string) => void;
  navigateTraceLink: (traceId: string) => void;

  importSession: (session: Session) => string;
  exportActiveSession: () => Session | null;
  upsertFileDiff: (sessionId: string, file: FileDiff, relatedTraceId?: string) => void;
  /**
   * Drop file diffs whose paths are not in `keepPaths`.
   * Used after git status sync so committed/clean files leave the Diff panel.
   */
  pruneFileDiffs: (sessionId: string, keepPaths: Set<string> | string[]) => void;
  addReviewComment: (
    sessionId: string,
    comment: Omit<import("./types").ReviewComment, "id" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    }
  ) => void;
  updateReviewComment: (
    sessionId: string,
    commentId: string,
    patch: Partial<import("./types").ReviewComment>
  ) => void;
  removeReviewComment: (sessionId: string, commentId: string) => void;
  setReviewMode: (sessionId: string, enabled: boolean) => void;
  pushPromptTurn: (sessionId: string, turn: import("./types").PromptTurn) => void;
  updatePromptTurn: (
    sessionId: string,
    turnId: string,
    patch: Partial<import("./types").PromptTurn>
  ) => void;
  clearSessionTraces: (sessionId: string) => void;
  setGrokFlags: (sessionId: string, flags: Record<string, unknown>) => void;

  // Phase 5 — automation / parallel
  monitorOpen: boolean;
  notificationsOpen: boolean;
  setMonitorOpen: (open: boolean) => void;
  setNotificationsOpen: (open: boolean) => void;
  automationJobs: import("./automation/types").AutomationJob[];
  automationMaxConcurrent: number;
  enqueueJob: (job: import("./automation/types").AutomationJob) => void;
  patchJob: (
    id: string,
    patch: Partial<import("./automation/types").AutomationJob>
  ) => void;
  clearFinishedJobs: () => void;
  notifications: import("./automation/types").AppNotification[];
  pushNotification: (n: import("./automation/types").AppNotification) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  compareSessionIds: [string, string] | null;
  setCompareSessionIds: (ids: [string, string] | null) => void;
  selectedSubagentLaneId: string | null;
  setSelectedSubagentLaneId: (id: string | null) => void;
  setSessionSubagentLanes: (
    sessionId: string,
    lanes: import("./automation/types").SubagentLane[]
  ) => void;
  hideSubagentFromThinking: boolean;
  setHideSubagentFromThinking: (v: boolean) => void;
}

export const useSpokStore = create<SpokState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  viewMode: "workspace",
  productMode: "run",
  workspaceRightTab: "changes",
  leftTraceMode: "thinking",
  causalDrawerOpen: false,
  sidebarOpen: true,
  commandPaletteOpen: false,
  importOpen: false,
  launchOpen: false,
  settingsOpen: false,
  extensionsOpen: false,
  selectedSkillIds: [],
  selectedAgentId: null,
  appPermissionMode: "manual",
  monitorOpen: false,
  notificationsOpen: false,
  automationJobs: [],
  automationMaxConcurrent: 2,
  notifications: [],
  compareSessionIds: null,
  selectedSubagentLaneId: null,
  hideSubagentFromThinking: true,
  hydrated: false,
  hydrating: false,
  traceFilter: {
    search: "",
    types: [],
    status: [],
    showOnlyLinked: false,
  },
  expandedNodeIds: new Set(),
  linkedHighlightFileId: null,
  crtEnabled: false,
  scanlines: false,
  uiTheme: "professional",
  reducedMotion: false,
  osNotifications: true,
  nativeFolderPicker: true,
  keyboardHelpOpen: false,
  diagnosticsOpen: false,

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    if (!activeSessionId) return null;
    return sessions[activeSessionId] ?? null;
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setProductMode: (mode) =>
    set((s) => {
      // Run/Review stay in workspace; Automate/Extend open progressive panels
      if (mode === "run") {
        return {
          productMode: mode,
          viewMode: "workspace",
          workspaceRightTab: "changes",
          monitorOpen: false,
          extensionsOpen: false,
        };
      }
      if (mode === "review") {
        return {
          productMode: mode,
          viewMode: "workspace",
          workspaceRightTab: "review",
          monitorOpen: false,
          extensionsOpen: false,
        };
      }
      if (mode === "automate") {
        return {
          productMode: mode,
          monitorOpen: true,
          extensionsOpen: false,
        };
      }
      // extend
      return {
        productMode: mode,
        extensionsOpen: true,
        monitorOpen: s.monitorOpen,
      };
    }),
  setWorkspaceRightTab: (tab) =>
    set({
      workspaceRightTab: tab,
      productMode: tab === "review" ? "review" : "run",
      viewMode: "workspace",
    }),
  setLeftTraceMode: (mode) => set({ leftTraceMode: mode }),
  setCausalDrawerOpen: (open) => set({ causalDrawerOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setImportOpen: (open) => set({ importOpen: open }),
  setLaunchOpen: (open) => set({ launchOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setExtensionsOpen: (open) => set({ extensionsOpen: open }),
  toggleSelectedSkill: (id) =>
    set((s) => ({
      selectedSkillIds: s.selectedSkillIds.includes(id)
        ? s.selectedSkillIds.filter((x) => x !== id)
        : [...s.selectedSkillIds, id],
    })),
  clearSelectedSkills: () => set({ selectedSkillIds: [] }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setAppPermissionMode: (mode) => set({ appPermissionMode: mode }),
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
  setUiTheme: (theme) => {
    if (theme === "crt") {
      set({ uiTheme: theme, crtEnabled: true, scanlines: true });
    } else {
      set({ uiTheme: theme, crtEnabled: false, scanlines: false });
    }
  },
  setReducedMotion: (v) => set({ reducedMotion: v }),
  setOsNotifications: (v) => set({ osNotifications: v }),
  setNativeFolderPicker: (v) => set({ nativeFolderPicker: v }),
  setKeyboardHelpOpen: (open) => set({ keyboardHelpOpen: open }),
  setDiagnosticsOpen: (open) => set({ diagnosticsOpen: open }),

  createSession: (partial, opts) => {
    const session = createSession(partial);
    const activate = opts?.activate !== false;
    set((s) => ({
      sessions: { ...s.sessions, [session.id]: session },
      activeSessionId: activate ? session.id : s.activeSessionId,
      expandedNodeIds: activate ? new Set() : s.expandedNodeIds,
    }));
    // Durable live sessions: register on disk (async, fire-and-forget)
    if (session.durable !== false && session.source === "live") {
      void registerDurableSession(session).catch((e) =>
        console.warn("[spok] durable register failed", e)
      );
    }
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

  deleteSession: (id) => {
    void deleteDurableSession(id);
    set((s) => {
      const { [id]: _removed, ...rest } = s.sessions;
      void _removed;
      return {
        sessions: rest,
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
      };
    });
  },

  hydrateSession: (session, opts) => {
    const activate = opts?.activate !== false;
    set((s) => ({
      sessions: { ...s.sessions, [session.id]: session },
      activeSessionId: activate ? session.id : s.activeSessionId,
      expandedNodeIds: activate
        ? new Set(Object.keys(session.nodes))
        : s.expandedNodeIds,
    }));
  },

  setHydrated: (v) => set({ hydrated: v }),
  setHydrating: (v) => set({ hydrating: v }),

  persistSessionNow: (sessionId) => {
    const session = get().sessions[sessionId];
    if (!session || session.durable === false) return;
    flushDurableSession(sessionId);
    void saveDurableSnapshot(session);
  },

  applyStreamEvent: (sessionId, event) => {
    const stamped = stampStreamEvent(event, {
      sessionId,
      provider: event.provider ?? "spok",
    });

    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      // Use stamped event for the rest of the reducer
      event = stamped;

      const appendLog = (updated: Session): Session => {
        const prevLog = session.eventLog ?? [];
        // Keep a bounded in-memory window; durable disk holds the full append-only log
        const MAX_MEM = 8_000;
        const nextLog =
          prevLog.length >= MAX_MEM
            ? [...prevLog.slice(prevLog.length - MAX_MEM + 1), stamped]
            : [...prevLog, stamped];
        return {
          ...updated,
          eventLog: nextLog,
          eventCount: (session.eventCount ?? prevLog.length) + 1,
        };
      };

      const nodes = { ...session.nodes };
      const files = { ...session.files };
      const rootTraceIds = [...session.rootTraceIds];
      let selectedFileId = session.selectedFileId;
      const expanded = new Set(s.expandedNodeIds);

      if (event.type === "session_start") {
        const updated = appendLog({
          ...session,
          status: "running",
          metrics: { ...session.metrics, startedAt: event.timestamp },
          updatedAt: Date.now(),
        });
        return {
          sessions: { ...s.sessions, [sessionId]: updated },
        };
      }

      if (event.type === "session_end") {
        const updated = appendLog({
          ...session,
          status: event.status === "error" ? "error" : "completed",
          metrics: {
            ...recomputeMetrics(session),
            endedAt: event.timestamp,
          },
          updatedAt: Date.now(),
        });
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
          const updated = appendLog({
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
          });
          updated.metrics = recomputeMetrics(updated);
          return {
            sessions: { ...s.sessions, [sessionId]: updated },
            expandedNodeIds: expanded,
            linkedHighlightFileId: fd.id,
          };
        }
      }

      // Generic trace node (upsert by id for chunk coalescing)
      // Fold thinking/reasoning fragments into the latest open thought node so
      // the UI never ends up with one node per streamed word/digit.
      let nodeId = event.id || nanoid(10);
      let existingNode = nodes[nodeId];
      const isThoughtType =
        event.type === "thinking" || event.type === "reasoning";
      if (isThoughtType) {
        const incoming = event.content || "";
        // Never fold CLI/Git noise into a thought node
        if (
          incoming &&
          isNonThoughtContent(incoming) &&
          !incoming.includes("\n")
        ) {
          event = { ...event, content: "", summary: undefined };
        } else if (incoming) {
          // Only coalesce same-id or true cumulative/stream deltas.
          // Distinct status thoughts must stay permanent separate nodes.
          const latestThought = Object.values(nodes)
            .filter((n) => n.type === "thinking" || n.type === "reasoning")
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          if (latestThought) {
            const prev = latestThought.content || "";
            const sameId = !!event.id && event.id === latestThought.id;
            const cumulative =
              incoming.startsWith(prev) ||
              (prev.startsWith(incoming) && incoming.length < prev.length);
            if (sameId || cumulative) {
              nodeId = latestThought.id;
              existingNode = latestThought;
              event = {
                ...event,
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
        // Streaming thoughts/messages: keep the fuller text when the same id
        // is updated (cumulative chunks must not shrink content to one word).
        const isProse =
          event.type === "thinking" ||
          event.type === "reasoning" ||
          event.type === "message" ||
          event.type === "plan" ||
          event.type === "plan_update";
        const nextContent = isProse
          ? preferFullerText(
              mergeStreamingText(
                existingNode?.content || "",
                event.content || ""
              ),
              preferFullerText(event.content, existingNode?.content)
            )
          : event.content !== undefined && event.content !== ""
            ? event.content
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
      const updated = appendLog({
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
      });
      if (!updated.metrics.startedAt) {
        updated.metrics = { ...updated.metrics, startedAt: event.timestamp };
      }
      updated.metrics = recomputeMetrics(updated);
      const providerTokens = extractProviderTokens(event.meta);
      if (providerTokens != null) {
        updated.metrics = mergeTokensIntoMetrics(
          updated.metrics,
          providerTokens
        );
      }

      return {
        sessions: { ...s.sessions, [sessionId]: updated },
        expandedNodeIds: expanded,
      };
    });

    // Append-only durable log (batched). Skip sample/paste playback noise unless durable.
    const session = get().sessions[sessionId];
    if (
      session &&
      session.durable !== false &&
      (session.source === "live" ||
        session.source === "resume" ||
        session.source === "import")
    ) {
      enqueueDurableEvents(sessionId, [stamped]);
    }
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
        // Open causal drawer when a file with linked steps is selected
        causalDrawerOpen: !!id && (session.files[id]?.relatedTraceIds.length ?? 0) > 0
          ? true
          : s.causalDrawerOpen,
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
      // Explicit booleans must win (including false). Only fall back when omitted.
      const has = (k: keyof FileDiff) =>
        Object.prototype.hasOwnProperty.call(file, k);

      files[id] = {
        ...existing,
        ...file,
        id,
        relatedTraceIds: [...related],
        staged: has("staged") ? file.staged : existing?.staged,
        unstaged: has("unstaged") ? file.unstaged : existing?.unstaged,
        untracked: has("untracked") ? file.untracked : existing?.untracked,
        conflict: has("conflict") ? file.conflict : existing?.conflict,
        isBinary: has("isBinary") ? file.isBinary : existing?.isBinary,
        isSecret: has("isSecret") ? file.isSecret : existing?.isSecret,
      };
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            files,
            fileTree: buildFileTree(Object.values(files)),
            // Don't steal focus on bulk refresh; select only if nothing selected
            selectedFileId: session.selectedFileId ?? id,
            updatedAt: Date.now(),
            metrics: recomputeMetrics({ ...session, files }),
          },
        },
      };
    }),

  pruneFileDiffs: (sessionId, keepPaths) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const keep =
        keepPaths instanceof Set
          ? keepPaths
          : new Set(
              keepPaths.map((p) => p.replace(/\\/g, "/"))
            );
      const files: Record<string, FileDiff> = {};
      let removed = false;
      for (const [id, f] of Object.entries(session.files)) {
        const key = f.path.replace(/\\/g, "/");
        if (keep.has(key) || keep.has(f.path)) {
          files[id] = f;
        } else {
          removed = true;
        }
      }
      if (!removed) return s;
      const selectedStill =
        session.selectedFileId && files[session.selectedFileId]
          ? session.selectedFileId
          : null;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            files,
            fileTree: buildFileTree(Object.values(files)),
            selectedFileId: selectedStill,
            updatedAt: Date.now(),
            metrics: recomputeMetrics({ ...session, files }),
          },
        },
      };
    }),

  addReviewComment: (sessionId, comment) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      const entry = {
        id: comment.id ?? nanoid(10),
        createdAt: comment.createdAt ?? Date.now(),
        path: comment.path,
        line: comment.line,
        hunkId: comment.hunkId,
        traceNodeId: comment.traceNodeId,
        body: comment.body,
        author: comment.author,
        resolved: comment.resolved,
      };
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            reviewComments: [...(session.reviewComments ?? []), entry],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  updateReviewComment: (sessionId, commentId, patch) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            reviewComments: (session.reviewComments ?? []).map((c) =>
              c.id === commentId ? { ...c, ...patch } : c
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeReviewComment: (sessionId, commentId) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            reviewComments: (session.reviewComments ?? []).filter(
              (c) => c.id !== commentId
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setReviewMode: (sessionId, enabled) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            reviewMode: enabled,
            updatedAt: Date.now(),
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

  setMonitorOpen: (open) => set({ monitorOpen: open }),
  setNotificationsOpen: (open) => set({ notificationsOpen: open }),

  enqueueJob: (job) =>
    set((s) => ({
      automationJobs: [job, ...s.automationJobs].slice(0, 100),
    })),

  patchJob: (id, patch) =>
    set((s) => ({
      automationJobs: s.automationJobs.map((j) =>
        j.id === id ? { ...j, ...patch } : j
      ),
    })),

  clearFinishedJobs: () =>
    set((s) => ({
      automationJobs: s.automationJobs.filter((j) =>
        ["queued", "running", "waiting_approval"].includes(j.status)
      ),
    })),

  pushNotification: (n) => {
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, 80),
    }));
    // Desktop / browser OS notification mirror (best-effort, never blocks UI)
    if (typeof window !== "undefined" && get().osNotifications) {
      const important = new Set([
        "run_complete",
        "run_failed",
        "run_cancelled",
        "approval_needed",
        "schedule_fired",
        "schedule_skipped",
        "channel_event",
        "subagent_complete",
      ]);
      if (important.has(n.kind)) {
        void import("./desktop")
          .then(({ showOsNotification }) =>
            showOsNotification({ title: n.title, body: n.body || "" })
          )
          .catch(() => undefined);
      }
    }
  },

  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  markAllNotificationsRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),

  clearNotifications: () => set({ notifications: [] }),

  setCompareSessionIds: (ids) => set({ compareSessionIds: ids }),
  setSelectedSubagentLaneId: (id) => set({ selectedSubagentLaneId: id }),

  setSessionSubagentLanes: (sessionId, lanes) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            subagentLanes: lanes,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setHideSubagentFromThinking: (v) => set({ hideSubagentFromThinking: v }),
}));
