/**
 * Lightweight performance telemetry for Spok Horizon 1 budgets.
 *
 * Browser: uses performance.now() + optional Performance API marks.
 * Node/tests: falls back to process.hrtime / Date.now.
 * Never throws; never logs secrets.
 */

export const PERF_BUDGETS = {
  /** Cold launch → usable shell (ms) */
  coldLaunchMs: 2000,
  /** Reopen recent session → first useful content (ms) */
  sessionReopenMs: 500,
  /** Main-thread work per stream batch after coalesce (ms) */
  streamIngestBurstMs: 16,
  /** Diff tab switch for common repos (ms) */
  diffTabSwitchMs: 300,
  /** Fixture replay of a mid-size session (ms) */
  fixtureReplayMs: 2000,
  /** Stream events reduced per second (throughput floor in tests) */
  streamEventsPerSec: 50,
} as const;

export type PerfMetricName =
  | "app_boot"
  | "first_session_paint"
  | "session_reopen"
  | "stream_ingest_burst"
  | "reduce_batch"
  | "trace_render"
  | "diff_tab_switch"
  | "fixture_replay"
  | "memory_heap";

export type PerfSample = {
  name: PerfMetricName | string;
  durationMs: number;
  ts: number;
  meta?: Record<string, number | string | boolean | undefined>;
  overBudget?: boolean;
  budgetMs?: number;
};

type Listener = (sample: PerfSample) => void;

const samples: PerfSample[] = [];
const MAX_SAMPLES = 400;
const listeners = new Set<Listener>();

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  if (typeof process !== "undefined" && process.hrtime?.bigint) {
    return Number(process.hrtime.bigint()) / 1e6;
  }
  return Date.now();
}

function budgetFor(name: string): number | undefined {
  switch (name) {
    case "app_boot":
    case "cold_launch":
      return PERF_BUDGETS.coldLaunchMs;
    case "first_session_paint":
    case "session_reopen":
      return PERF_BUDGETS.sessionReopenMs;
    case "stream_ingest_burst":
    case "reduce_batch":
      return PERF_BUDGETS.streamIngestBurstMs;
    case "diff_tab_switch":
      return PERF_BUDGETS.diffTabSwitchMs;
    case "fixture_replay":
      return PERF_BUDGETS.fixtureReplayMs;
    default:
      return undefined;
  }
}

/** Record a completed duration sample. */
export function recordPerf(
  name: PerfMetricName | string,
  durationMs: number,
  meta?: PerfSample["meta"]
): PerfSample {
  const budgetMs = budgetFor(name);
  const sample: PerfSample = {
    name,
    durationMs: Math.max(0, durationMs),
    ts: Date.now(),
    meta,
    budgetMs,
    overBudget: budgetMs != null ? durationMs > budgetMs : undefined,
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  for (const l of listeners) {
    try {
      l(sample);
    } catch {
      /* ignore */
    }
  }
  return sample;
}

/** Time a synchronous function. */
export function measureSync<T>(
  name: PerfMetricName | string,
  fn: () => T,
  meta?: PerfSample["meta"]
): T {
  const t0 = nowMs();
  try {
    return fn();
  } finally {
    recordPerf(name, nowMs() - t0, meta);
  }
}

/** Time an async function. */
export async function measureAsync<T>(
  name: PerfMetricName | string,
  fn: () => Promise<T>,
  meta?: PerfSample["meta"]
): Promise<T> {
  const t0 = nowMs();
  try {
    return await fn();
  } finally {
    recordPerf(name, nowMs() - t0, meta);
  }
}

/** Start a mark; call end() to record. */
export function startMark(name: PerfMetricName | string): {
  end: (meta?: PerfSample["meta"]) => PerfSample;
} {
  const t0 = nowMs();
  return {
    end(meta) {
      return recordPerf(name, nowMs() - t0, meta);
    },
  };
}

export function getPerfSamples(limit = 100): PerfSample[] {
  return samples.slice(-limit);
}

export function getPerfSummary(): {
  count: number;
  overBudget: number;
  latest: PerfSample[];
  byName: Record<string, { count: number; p50: number; max: number; overBudget: number }>;
} {
  const byName: Record<
    string,
    { values: number[]; overBudget: number }
  > = {};
  for (const s of samples) {
    const b = (byName[s.name] ??= { values: [], overBudget: 0 });
    b.values.push(s.durationMs);
    if (s.overBudget) b.overBudget += 1;
  }
  const summary: Record<
    string,
    { count: number; p50: number; max: number; overBudget: number }
  > = {};
  for (const [name, b] of Object.entries(byName)) {
    const sorted = [...b.values].sort((a, c) => a - c);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
    summary[name] = {
      count: sorted.length,
      p50: mid,
      max: sorted[sorted.length - 1] ?? 0,
      overBudget: b.overBudget,
    };
  }
  return {
    count: samples.length,
    overBudget: samples.filter((s) => s.overBudget).length,
    latest: samples.slice(-20),
    byName: summary,
  };
}

export function clearPerfSamples(): void {
  samples.length = 0;
}

export function subscribePerf(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Best-effort heap snapshot (browser or Node). */
export function sampleMemoryHeap(): PerfSample | null {
  try {
    // Chrome
    const perfMem = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    if (perfMem?.usedJSHeapSize != null) {
      return recordPerf("memory_heap", 0, {
        usedJsHeapBytes: perfMem.usedJSHeapSize,
      });
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== "undefined" && process.memoryUsage) {
      const m = process.memoryUsage();
      return recordPerf("memory_heap", 0, {
        usedJsHeapBytes: m.heapUsed,
        rssBytes: m.rss,
      });
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Boot mark set once from the app shell. */
let bootMark: ReturnType<typeof startMark> | null = null;

export function markAppBootStart(): void {
  if (bootMark) return;
  bootMark = startMark("app_boot");
}

export function markAppBootEnd(meta?: PerfSample["meta"]): void {
  if (!bootMark) return;
  bootMark.end(meta);
  bootMark = null;
}
