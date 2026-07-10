/**
 * Shared mobile/desktop host sync: live process list + durable event pull.
 * Keeps both UIs aligned while they share the same Spok server / disk.
 */

import {
  fetchLiveProcesses,
  listDurableSessions,
  loadDurableSession,
  type LiveProcessInfo,
} from "./session-persist-client";
import { useSpokStore } from "./store";
import type { Session, SessionMetaRecord, SessionStatus, StreamEvent } from "./types";

export type HostSyncSnapshot = {
  metas: SessionMetaRecord[];
  liveProcesses: LiveProcessInfo[];
  liveSessionIds: string[];
  time: number;
};

/** Terminal statuses — never show as "live" without a host process. */
export function isTerminalSessionStatus(status: SessionStatus | undefined): boolean {
  return (
    status === "completed" ||
    status === "error" ||
    status === "stopped" ||
    status === "ready" ||
    status === "idle"
  );
}

/**
 * Resolve session status from host process + disk meta + local state.
 * Process registry is authoritative for "running".
 */
export function resolveSyncedStatus(opts: {
  sessionId: string;
  liveIds: Set<string>;
  metaStatus?: SessionStatus;
  localStatus?: SessionStatus;
}): SessionStatus {
  if (opts.liveIds.has(opts.sessionId)) return "running";

  const meta = opts.metaStatus;
  const local = opts.localStatus;

  // Prefer terminal local if we already finished the stream on this client
  if (
    local === "completed" ||
    local === "error" ||
    local === "stopped"
  ) {
    return local;
  }

  // Disk says running but no process → idle/ready
  if (meta === "running" || meta === "starting") {
    return "ready";
  }

  if (meta) return meta;
  if (local === "running" || local === "starting") {
    // Stale local live flag without host process
    return "ready";
  }
  return local ?? "ready";
}

export async function fetchHostSyncSnapshot(): Promise<HostSyncSnapshot> {
  const [metas, live] = await Promise.all([
    listDurableSessions().catch(() => [] as SessionMetaRecord[]),
    fetchLiveProcesses().catch(() => ({
      processes: [] as LiveProcessInfo[],
      liveSessionIds: [] as string[],
      time: Date.now(),
    })),
  ]);
  return {
    metas,
    liveProcesses: live.processes,
    liveSessionIds: live.liveSessionIds,
    time: live.time,
  };
}

/**
 * Apply new durable events onto a session and align status/prompt history.
 * `pulledCount` maps sessionId → number of disk events already applied.
 */
export async function pullAndMergeSession(
  sessionId: string,
  opts: {
    liveIds: string[];
    pulledCount: Record<string, number>;
    /** When true, activate session if missing (desktop/mobile watching) */
    activateIfMissing?: boolean;
  }
): Promise<{ added: number; status: SessionStatus }> {
  const liveSet = new Set(opts.liveIds);
  const bundle = await loadDurableSession(sessionId);
  const events = bundle.events ?? [];
  const store = useSpokStore.getState();
  let session = store.sessions[sessionId];

  // Bootstrap pulled cursor: don't re-apply events already in memory
  if (opts.pulledCount[sessionId] == null && session) {
    opts.pulledCount[sessionId] = Math.max(
      session.eventCount ?? 0,
      session.eventLog?.length ?? 0
    );
    // If disk is shorter (rotated), reset
    if (opts.pulledCount[sessionId] > events.length) {
      opts.pulledCount[sessionId] = 0;
    }
  }

  const already = opts.pulledCount[sessionId] ?? 0;
  const slice: StreamEvent[] =
    events.length > already ? events.slice(already) : [];

  if (!session) {
    if (bundle.snapshot) {
      const status = resolveSyncedStatus({
        sessionId,
        liveIds: liveSet,
        metaStatus: bundle.meta?.status ?? bundle.snapshot.status,
        localStatus: bundle.snapshot.status,
      });
      store.hydrateSession(
        {
          ...bundle.snapshot,
          id: sessionId,
          status,
          source: "resume",
          durable: true,
          eventLog: bundle.snapshot.eventLog ?? events.slice(-200),
          eventCount: events.length,
        },
        { activate: opts.activateIfMissing === true }
      );
      // Cursor: full disk applied via snapshot nodes; only new tail next time
      opts.pulledCount[sessionId] = events.length;
      session = useSpokStore.getState().sessions[sessionId];
    } else if (bundle.meta) {
      store.createSession(
        {
          id: sessionId,
          name: bundle.meta.name,
          source: "resume",
          status: resolveSyncedStatus({
            sessionId,
            liveIds: liveSet,
            metaStatus: bundle.meta.status,
          }),
          config: {
            cwd: bundle.meta.cwd || "",
            command: bundle.meta.command || "grok",
            args: [],
            autoScroll: true,
            playbackSpeed: 1,
          },
          durable: false,
          eventCount: 0,
        },
        { activate: opts.activateIfMissing === true }
      );
      opts.pulledCount[sessionId] = 0;
      session = useSpokStore.getState().sessions[sessionId];
      // Apply all events in one store commit (avoids N React re-renders)
      if (events.length) store.applyStreamEvents(sessionId, events);
      opts.pulledCount[sessionId] = events.length;
    }
  } else if (slice.length) {
    store.applyStreamEvents(sessionId, slice);
    opts.pulledCount[sessionId] = events.length;
  } else {
    opts.pulledCount[sessionId] = Math.max(already, events.length);
  }

  session = useSpokStore.getState().sessions[sessionId];
  const nextStatus = resolveSyncedStatus({
    sessionId,
    liveIds: liveSet,
    metaStatus: bundle.meta?.status,
    localStatus: session?.status,
  });

  const patch: Partial<Session> = { status: nextStatus };
  if (bundle.meta?.name) patch.name = bundle.meta.name;

  // Sync prompt history from snapshot (other client may have added turns)
  const snapHist = bundle.snapshot?.promptHistory;
  if (snapHist?.length) {
    const localHist = session?.promptHistory ?? [];
    if (
      snapHist.length > localHist.length ||
      (snapHist.length === localHist.length &&
        snapHist[snapHist.length - 1]?.id !==
          localHist[localHist.length - 1]?.id)
    ) {
      patch.promptHistory = snapHist;
    }
  }

  // Sync files from snapshot if peer produced diffs
  if (bundle.snapshot?.files && Object.keys(bundle.snapshot.files).length) {
    const localFiles = Object.keys(session?.files ?? {}).length;
    const snapFiles = Object.keys(bundle.snapshot.files).length;
    if (snapFiles >= localFiles) {
      patch.files = bundle.snapshot.files;
      patch.fileTree = bundle.snapshot.fileTree;
      patch.metrics = {
        ...session!.metrics,
        ...bundle.snapshot.metrics,
        filesChanged: Math.max(
          session?.metrics.filesChanged ?? 0,
          bundle.snapshot.metrics?.filesChanged ?? 0
        ),
      };
    }
  }

  store.updateSession(sessionId, patch);
  return { added: slice.length, status: nextStatus };
}
