"use client";

import { localFetch } from "./local-api-client";
import type { Session, SessionMetaRecord, StreamEvent } from "./types";

export type DurableSessionBundle = {
  meta: SessionMetaRecord | null;
  snapshot: Session | null;
  events: StreamEvent[];
};

/** List sessions from the durable store. */
export async function listDurableSessions(): Promise<SessionMetaRecord[]> {
  const res = await localFetch("/api/sessions");
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `List sessions failed (${res.status})`);
  }
  const data = (await res.json()) as { sessions: SessionMetaRecord[] };
  return data.sessions ?? [];
}

export type LiveProcessInfo = {
  sessionId: string;
  pid: number;
  command: string;
  cwd: string;
  startedAt: number;
  timedOut?: boolean;
  killed?: boolean;
};

/** Host processes currently registered (running Grok jobs). */
export async function fetchLiveProcesses(): Promise<{
  processes: LiveProcessInfo[];
  liveSessionIds: string[];
  time: number;
}> {
  const res = await localFetch("/api/runtime/live");
  if (!res.ok) {
    throw new Error(`Live processes failed (${res.status})`);
  }
  const data = (await res.json()) as {
    processes?: LiveProcessInfo[];
    liveSessionIds?: string[];
    time?: number;
  };
  return {
    processes: data.processes ?? [],
    liveSessionIds: data.liveSessionIds ?? [],
    time: data.time ?? Date.now(),
  };
}

/** Create on-disk durable session directory. */
export async function registerDurableSession(session: Session): Promise<void> {
  const res = await localFetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: session.id,
      name: session.name,
      status: session.status,
      cwd: session.config.cwd,
      command: session.config.command,
      source: session.source,
      grokFlags: session.grokFlags,
      createdAt: session.createdAt,
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Register session failed (${res.status})`);
  }
}

export async function loadDurableSession(
  id: string,
  opts?: { raw?: boolean }
): Promise<DurableSessionBundle> {
  const q = opts?.raw ? "?raw=1" : "";
  const res = await localFetch(`/api/sessions/${encodeURIComponent(id)}${q}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Load session failed (${res.status})`);
  }
  return (await res.json()) as DurableSessionBundle;
}

export async function appendDurableEvents(
  id: string,
  events: StreamEvent[],
  raw?: Array<{ kind?: "stdout" | "stderr" | "line" | "client" | "system"; data: string }>
): Promise<void> {
  if (!events.length && !raw?.length) return;
  const res = await localFetch(
    `/api/sessions/${encodeURIComponent(id)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, raw }),
    }
  );
  if (!res.ok) {
    // Soft-fail persistence so the live UI is not blocked
    console.warn("[spok] appendDurableEvents failed", res.status);
  }
}

export async function saveDurableSnapshot(session: Session): Promise<void> {
  const res = await localFetch(
    `/api/sessions/${encodeURIComponent(session.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshot: session,
        meta: {
          name: session.name,
          status: session.status,
          cwd: session.config.cwd,
          command: session.config.command,
          source: session.source,
          grokFlags: session.grokFlags,
          error: session.error,
        },
      }),
    }
  );
  if (!res.ok) {
    console.warn("[spok] saveDurableSnapshot failed", res.status);
  }
}

export async function deleteDurableSession(id: string): Promise<void> {
  await localFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

/** In-memory queue that batches event writes per session. */
const queues = new Map<
  string,
  {
    events: StreamEvent[];
    raw: Array<{ kind: "line" | "client" | "system" | "stdout" | "stderr"; data: string }>;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

function flushQueue(id: string) {
  const q = queues.get(id);
  if (!q) return;
  const events = q.events.splice(0, q.events.length);
  const raw = q.raw.splice(0, q.raw.length);
  if (q.timer) {
    clearTimeout(q.timer);
    q.timer = null;
  }
  if (!events.length && !raw.length) return;
  void appendDurableEvents(id, events, raw);
}

export function enqueueDurableEvents(
  sessionId: string,
  events: StreamEvent[],
  rawLines?: string[]
) {
  let q = queues.get(sessionId);
  if (!q) {
    q = { events: [], raw: [], timer: null };
    queues.set(sessionId, q);
  }
  q.events.push(...events);
  if (rawLines?.length) {
    for (const line of rawLines) {
      q.raw.push({ kind: "line", data: line });
    }
  }
  if (!q.timer) {
    q.timer = setTimeout(() => flushQueue(sessionId), 200);
  }
}

export function flushDurableSession(sessionId: string) {
  flushQueue(sessionId);
}
