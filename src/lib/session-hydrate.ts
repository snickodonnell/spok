/**
 * Fast session materialization for boot restore.
 *
 * Strategy:
 * 1. Meta shells for the sidebar (no disk body).
 * 2. Snapshot-first for the active session (skip events.ndjson when possible).
 * 3. Full event replay only when there is no snapshot.
 * 4. Background materialization of other sessions after UI is interactive.
 */

import {
  loadDurableSession,
  type DurableSessionBundle,
} from "./session-persist-client";
import { replayEvents } from "./session-replay";
import type { Session, SessionMetaRecord, StreamEvent } from "./types";

const MAX_MEM_EVENT_LOG = 80;
const MAX_MEM_RAW_LOG = 400;

function normalizeStatus(status: Session["status"] | undefined): Session["status"] {
  if (status === "running" || status === "starting") return "ready";
  return status ?? "ready";
}

/** Lightweight sidebar entry — no nodes/files/events. */
export function metaShellSession(meta: SessionMetaRecord): Session {
  return {
    id: meta.id,
    name: meta.name,
    status: normalizeStatus(meta.status),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    config: {
      cwd: meta.cwd || "",
      command: meta.command || "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
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
    },
    rootTraceIds: [],
    nodes: {},
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: "resume",
    promptHistory: [],
    grokFlags: meta.grokFlags,
    eventLog: [],
    durable: true,
    eventCount: meta.eventCount ?? 0,
    hydratePartial: true,
  };
}

function trimSessionMemory(session: Session, eventCountHint?: number): Session {
  const eventLog = session.eventLog ?? [];
  const rawLog = session.rawLog ?? [];
  return {
    ...session,
    hydratePartial: false,
    durable: true,
    source: "resume",
    status: normalizeStatus(session.status),
    eventLog:
      eventLog.length > MAX_MEM_EVENT_LOG
        ? eventLog.slice(eventLog.length - MAX_MEM_EVENT_LOG)
        : eventLog,
    rawLog:
      rawLog.length > MAX_MEM_RAW_LOG
        ? rawLog.slice(rawLog.length - MAX_MEM_RAW_LOG)
        : rawLog,
    eventCount:
      eventCountHint ??
      session.eventCount ??
      eventLog.length,
  };
}

function sessionFromSnapshot(
  snapshot: Session,
  meta: SessionMetaRecord | null,
  tailEvents: StreamEvent[]
): Session {
  const eventCount =
    meta?.eventCount ??
    snapshot.eventCount ??
    tailEvents.length ??
    snapshot.eventLog?.length ??
    0;
  return trimSessionMemory(
    {
      ...snapshot,
      id: meta?.id ?? snapshot.id,
      name: meta?.name ?? snapshot.name,
      source: "resume",
      status: normalizeStatus(snapshot.status),
      durable: true,
      // Prefer short tails; disk keeps the full log
      eventLog:
        tailEvents.length > 0
          ? tailEvents.slice(-MAX_MEM_EVENT_LOG)
          : (snapshot.eventLog ?? []).slice(-MAX_MEM_EVENT_LOG),
      promptHistory: snapshot.promptHistory ?? [],
      grokFlags: snapshot.grokFlags ?? meta?.grokFlags,
    },
    eventCount
  );
}

function sessionFromReplay(
  events: StreamEvent[],
  meta: SessionMetaRecord,
  snapshot: Session | null
): Session {
  const session = replayEvents(events, {
    id: meta.id,
    name: meta.name,
    source: "resume",
    status: normalizeStatus(meta.status),
    createdAt: meta.createdAt,
    grokFlags: meta.grokFlags,
    config: {
      cwd: meta.cwd,
      command: meta.command || "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
  });
  session.updatedAt = meta.updatedAt;
  session.durable = true;
  session.eventCount = events.length;
  session.eventLog = events.slice(-MAX_MEM_EVENT_LOG);
  if (snapshot?.promptHistory?.length) {
    session.promptHistory = snapshot.promptHistory;
  }
  if (snapshot?.grokFlags) {
    session.grokFlags = snapshot.grokFlags;
  }
  if (snapshot?.rawLog?.length && !session.rawLog.length) {
    session.rawLog = snapshot.rawLog.slice(-MAX_MEM_RAW_LOG);
  }
  if (snapshot?.reviewComments?.length) {
    session.reviewComments = snapshot.reviewComments;
  }
  if (snapshot?.gitSummary) {
    session.gitSummary = snapshot.gitSummary;
  }
  return trimSessionMemory(session, events.length);
}

/**
 * Materialize a session for UI use.
 *
 * - `mode: "snapshot"` — snapshot only (no events.ndjson). Fast.
 * - `mode: "full"` — snapshot preferred; fall back to full event replay.
 */
export async function materializeDurableSession(
  meta: SessionMetaRecord,
  mode: "snapshot" | "full" = "full"
): Promise<Session> {
  // Snapshot-first: skip multi-MB events.ndjson when a snapshot exists.
  let bundle: DurableSessionBundle;
  try {
    bundle = await loadDurableSession(meta.id, { events: false });
  } catch {
    bundle = { meta, snapshot: null, events: [] };
  }

  if (bundle.snapshot) {
    return sessionFromSnapshot(bundle.snapshot, bundle.meta ?? meta, []);
  }

  if (mode === "snapshot") {
    // No snapshot on disk — keep shell; caller may full-load later.
    return metaShellSession(meta);
  }

  // Full path: load events only when needed (no snapshot).
  try {
    bundle = await loadDurableSession(meta.id, { events: true });
  } catch (e) {
    console.warn("[spok] full materialize failed", meta.id, e);
    return metaShellSession(meta);
  }

  if (bundle.snapshot) {
    return sessionFromSnapshot(
      bundle.snapshot,
      bundle.meta ?? meta,
      bundle.events ?? []
    );
  }

  if (bundle.events?.length) {
    return sessionFromReplay(bundle.events, meta, null);
  }

  return metaShellSession({
    ...meta,
    ...(bundle.meta ?? {}),
  });
}

/** In-flight materializations so activate doesn't double-fetch. */
const inflight = new Map<string, Promise<Session>>();

export function materializeDurableSessionOnce(
  meta: SessionMetaRecord,
  mode: "snapshot" | "full" = "full"
): Promise<Session> {
  const key = `${meta.id}:${mode}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = materializeDurableSession(meta, mode).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
