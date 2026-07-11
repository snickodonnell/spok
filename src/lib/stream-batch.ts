/**
 * Coalesce high-rate stream events into at most one Zustand commit per frame.
 *
 * Live Grok NDJSON often yields many thinking/tool chunks per network read.
 * Without batching, each event forces a React re-render of the active session.
 * This queue flushes on requestAnimationFrame (or setTimeout in Node).
 *
 * Under heavy load (large pending queues), we also coalesce across two rAFs
 * so reduce + React paint can complete without stacking more commits.
 */

import type { StreamEvent } from "./types";
import { useSpokStore } from "./store";
import { startMark } from "./perf";

type SessionQueue = {
  events: StreamEvent[];
  rawLogs: string[];
};

const queues = new Map<string, SessionQueue>();
let flushScheduled = false;
let scheduleHandle: number | null = null;
/** When the last flush took longer than a frame, skip a frame before next. */
let heavyLoad = false;

const HEAVY_FLUSH_MS = 12;
/** Soft cap: if more than this many events are pending, force flush now. */
const FORCE_FLUSH_EVENTS = 250;

function getQueue(sessionId: string): SessionQueue {
  let q = queues.get(sessionId);
  if (!q) {
    q = { events: [], rawLogs: [] };
    queues.set(sessionId, q);
  }
  return q;
}

function pendingEventCount(): number {
  let n = 0;
  for (const q of queues.values()) n += q.events.length;
  return n;
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;

  const run = () => {
    scheduleHandle = null;
    if (heavyLoad && typeof requestAnimationFrame === "function") {
      // Yield one frame so React can paint after a heavy reduce.
      heavyLoad = false;
      scheduleHandle = requestAnimationFrame(() => {
        scheduleHandle = null;
        flushStreamBatch();
      }) as unknown as number;
      return;
    }
    flushStreamBatch();
  };

  // Large backlog: flush ASAP via microtask/timeout rather than waiting for rAF
  // (rAF can be delayed under tab backgrounding / long paints).
  if (pendingEventCount() >= FORCE_FLUSH_EVENTS) {
    if (typeof setTimeout === "function") {
      scheduleHandle = setTimeout(run, 0) as unknown as number;
    } else {
      run();
    }
    return;
  }

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

  const mark = startMark("stream_ingest_burst");
  let eventCount = 0;
  let logCount = 0;
  const store = useSpokStore.getState();
  const t0 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  for (const [sessionId, q] of snapshot) {
    if (q.rawLogs.length) {
      logCount += q.rawLogs.length;
      store.appendRawLogs(sessionId, q.rawLogs);
    }
    if (q.events.length) {
      eventCount += q.events.length;
      store.applyStreamEvents(sessionId, q.events);
    }
  }
  const t1 =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  heavyLoad = t1 - t0 > HEAVY_FLUSH_MS;
  mark.end({ eventCount, logCount, sessions: snapshot.length });
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
  heavyLoad = false;
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
