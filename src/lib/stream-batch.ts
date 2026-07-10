/**
 * Coalesce high-rate stream events into at most one Zustand commit per frame.
 *
 * Live Grok NDJSON often yields many thinking/tool chunks per network read.
 * Without batching, each event forces a React re-render of the active session.
 * This queue flushes on requestAnimationFrame (or setTimeout(0) in Node).
 */

import type { StreamEvent } from "./types";
import { useSpokStore } from "./store";

type SessionQueue = {
  events: StreamEvent[];
  rawLogs: string[];
};

const queues = new Map<string, SessionQueue>();
let flushScheduled = false;
let scheduleHandle: number | null = null;

function getQueue(sessionId: string): SessionQueue {
  let q = queues.get(sessionId);
  if (!q) {
    q = { events: [], rawLogs: [] };
    queues.set(sessionId, q);
  }
  return q;
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;

  const run = () => {
    scheduleHandle = null;
    flushStreamBatch();
  };

  if (typeof requestAnimationFrame === "function") {
    scheduleHandle = requestAnimationFrame(run) as unknown as number;
  } else {
    scheduleHandle = setTimeout(run, 0) as unknown as number;
  }
}

/** Enqueue stream events; flushed on next animation frame. */
export function enqueueStreamEvents(
  sessionId: string,
  events: StreamEvent[]
): void {
  if (!events.length) return;
  const q = getQueue(sessionId);
  q.events.push(...events);
  scheduleFlush();
}

/** Enqueue raw log lines; flushed with the same frame as events. */
export function enqueueRawLogLines(
  sessionId: string,
  lines: string[]
): void {
  if (!lines.length) return;
  const q = getQueue(sessionId);
  q.rawLogs.push(...lines);
  scheduleFlush();
}

/** Enqueue a single event (convenience). */
export function enqueueStreamEvent(
  sessionId: string,
  event: StreamEvent
): void {
  enqueueStreamEvents(sessionId, [event]);
}

/**
 * Immediately flush all pending queues into the store.
 * Safe to call when no work is pending. Used after stream end and in tests.
 */
export function flushStreamBatch(): void {
  flushScheduled = false;
  if (scheduleHandle != null) {
    if (typeof cancelAnimationFrame === "function") {
      try {
        cancelAnimationFrame(scheduleHandle);
      } catch {
        clearTimeout(scheduleHandle);
      }
    } else {
      clearTimeout(scheduleHandle);
    }
    scheduleHandle = null;
  }

  if (queues.size === 0) return;

  const snapshot = Array.from(queues.entries());
  queues.clear();

  const store = useSpokStore.getState();
  for (const [sessionId, q] of snapshot) {
    if (q.rawLogs.length) {
      store.appendRawLogs(sessionId, q.rawLogs);
    }
    if (q.events.length) {
      store.applyStreamEvents(sessionId, q.events);
    }
  }
}

/** Pending event count across all sessions (tests / diagnostics). */
export function pendingStreamBatchCount(): number {
  let n = 0;
  for (const q of queues.values()) {
    n += q.events.length + q.rawLogs.length;
  }
  return n;
}

/** Drop pending work without applying (tests only). */
export function clearStreamBatch(): void {
  queues.clear();
  flushScheduled = false;
  if (scheduleHandle != null) {
    if (typeof cancelAnimationFrame === "function") {
      try {
        cancelAnimationFrame(scheduleHandle);
      } catch {
        clearTimeout(scheduleHandle);
      }
    } else {
      clearTimeout(scheduleHandle);
    }
    scheduleHandle = null;
  }
}
