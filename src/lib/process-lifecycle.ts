/**
 * Process lifecycle helpers (Phase 7).
 * Tree kill, timeout policy, and registry metadata for harness children.
 */

import { spawn, type ChildProcess } from "child_process";
import { platform } from "os";

export type ProcessRecord = {
  sessionId: string;
  runId?: string;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt: number;
  /** Soft timeout ms; 0 = none */
  timeoutMs: number;
  timedOut?: boolean;
  killed?: boolean;
};

export type ProcessLifecycleStatus =
  | {
      sessionId: string;
      runId?: string;
      state: "running" | "stopping";
      pid: number;
      startedAt: number;
      timeoutMs: number;
    }
  | {
      sessionId: string;
      runId?: string;
      state: "exited";
      startedAt: number;
      endedAt: number;
      exitCode: number;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
    };

/** Default run timeout: 2 hours. Override with SPOK_RUN_TIMEOUT_MS. */
export function defaultRunTimeoutMs(): number {
  const raw = process.env.SPOK_RUN_TIMEOUT_MS?.trim();
  if (raw === "0") return 0;
  if (raw && /^\d+$/.test(raw)) {
    return Math.max(0, Math.min(24 * 60 * 60 * 1000, parseInt(raw, 10)));
  }
  return 2 * 60 * 60 * 1000;
}

/**
 * Kill a process and its descendants.
 * Windows: taskkill /T /F
 * Unix: process group kill when detached, else SIGTERM then SIGKILL.
 */
export function killProcessTree(
  proc: ChildProcess,
  opts?: { force?: boolean; signal?: NodeJS.Signals }
): { ok: boolean; method: string; error?: string } {
  const force = opts?.force !== false;
  const pid = proc.pid;
  if (!pid || proc.killed) {
    return { ok: true, method: "already_dead" };
  }

  const os = platform();

  if (os === "win32") {
    try {
      // /T = tree, /F = force
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref?.();
      // Also signal the handle so Node marks it killed
      try {
        proc.kill(force ? "SIGKILL" : "SIGTERM");
      } catch {
        /* taskkill is authoritative on Windows */
      }
      return { ok: true, method: "taskkill_tree" };
    } catch {
      try {
        proc.kill();
        return { ok: true, method: "node_kill_fallback" };
      } catch (e2) {
        return {
          ok: false,
          method: "failed",
          error: e2 instanceof Error ? e2.message : String(e2),
        };
      }
    }
  }

  // POSIX: try group first (negative pid) if we spawned with detached process group
  try {
    if (force) {
      try {
        process.kill(-pid, "SIGKILL");
        return { ok: true, method: "posix_group_sigkill" };
      } catch {
        /* not a group leader / ESRCH */
      }
      proc.kill("SIGKILL");
      return { ok: true, method: "posix_sigkill" };
    }
    try {
      process.kill(-pid, opts?.signal ?? "SIGTERM");
      return { ok: true, method: "posix_group_sigterm" };
    } catch {
      proc.kill(opts?.signal ?? "SIGTERM");
      return { ok: true, method: "posix_sigterm" };
    }
  } catch (e) {
    return {
      ok: false,
      method: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Schedule a force-kill if the process is still alive after graceMs.
 * Returns a cancel function.
 */
export function scheduleForceKill(
  proc: ChildProcess,
  graceMs = 2500
): () => void {
  const timer = setTimeout(() => {
    if (!proc.killed && proc.pid) {
      killProcessTree(proc, { force: true });
    }
  }, graceMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}

/** In-memory registry shared by the session start route. */
const registry = new Map<string, ProcessRecord & { child: ChildProcess }>();
const terminalRegistry = new Map<
  string,
  Extract<ProcessLifecycleStatus, { state: "exited" }>
>();
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TERMINAL_RECORDS = 512;

export function registerProcess(
  record: ProcessRecord,
  child: ChildProcess
): void {
  terminalRegistry.delete(record.sessionId);
  registry.set(record.sessionId, { ...record, child });
}

export function getProcess(sessionId: string) {
  return registry.get(sessionId);
}

/**
 * Return a sanitized lifecycle projection for exact-session recovery.
 * Command argv and environment never cross this boundary.
 */
export function getProcessStatus(
  sessionId: string
): ProcessLifecycleStatus | undefined {
  pruneTerminalRecords();
  const entry = registry.get(sessionId);
  if (entry) {
    if (entry.child.exitCode != null || entry.child.signalCode != null) {
      recordProcessExit(sessionId, {
        exitCode: entry.child.exitCode ?? 1,
        signal: entry.child.signalCode,
        timedOut: entry.timedOut === true,
      });
      return terminalRegistry.get(sessionId);
    }
    return {
      sessionId,
      ...(entry.runId ? { runId: entry.runId } : {}),
      state: entry.killed || entry.child.killed ? "stopping" : "running",
      pid: entry.pid,
      startedAt: entry.startedAt,
      timeoutMs: entry.timeoutMs,
    };
  }
  return terminalRegistry.get(sessionId);
}

export function recordProcessExit(
  sessionId: string,
  outcome: {
    exitCode: number;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    endedAt?: number;
  }
): void {
  const entry = registry.get(sessionId);
  const prior = terminalRegistry.get(sessionId);
  const endedAt = outcome.endedAt ?? Date.now();
  terminalRegistry.set(sessionId, {
    sessionId,
    ...(entry?.runId || prior?.runId
      ? { runId: entry?.runId ?? prior?.runId }
      : {}),
    state: "exited",
    startedAt: entry?.startedAt ?? prior?.startedAt ?? endedAt,
    endedAt,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
  });
  registry.delete(sessionId);
  pruneTerminalRecords();
}

export function unregisterProcess(sessionId: string): void {
  registry.delete(sessionId);
}

export function listProcesses(): ProcessRecord[] {
  // Drop exited / killed entries so "live" UI never sticks after a run ends
  pruneStaleProcesses();
  return [...registry.values()]
    .filter((entry) => !entry.killed && entry.child.exitCode == null)
    .map((entry) => {
      const { child, ...rest } = entry;
      void child;
      return rest;
    });
}

export function stopSessionProcess(
  sessionId: string,
  opts?: { force?: boolean }
): {
  ok: boolean;
  found: boolean;
  method?: string;
  error?: string;
} {
  const entry = registry.get(sessionId);
  if (!entry) {
    return { ok: true, found: false };
  }
  const result = killProcessTree(entry.child, { force: opts?.force !== false });
  entry.killed = true;
  // Keep entry briefly so exit handler can still clean up; route also deletes
  if (result.ok) {
    scheduleForceKill(entry.child, 1500);
  }
  return { ok: result.ok, found: true, method: result.method, error: result.error };
}

/** Stop every registered harness process during runtime supervisor shutdown. */
export function stopAllProcesses(): number {
  let stopped = 0;
  for (const [sessionId, entry] of registry) {
    if (entry.child.exitCode == null && !entry.killed) {
      killProcessTree(entry.child, { force: true });
      stopped++;
    }
    registry.delete(sessionId);
  }
  return stopped;
}

/** Remove stale entries (process exited but not cleaned). */
export function pruneStaleProcesses(): number {
  let n = 0;
  for (const [id, entry] of registry) {
    if (entry.child.exitCode != null || entry.child.signalCode != null) {
      recordProcessExit(id, {
        exitCode: entry.child.exitCode ?? 1,
        signal: entry.child.signalCode,
        timedOut: entry.timedOut === true,
      });
      n++;
    }
  }
  return n;
}

function pruneTerminalRecords(now = Date.now()): void {
  for (const [id, record] of terminalRegistry) {
    if (now - record.endedAt > TERMINAL_RETENTION_MS) {
      terminalRegistry.delete(id);
    }
  }
  while (terminalRegistry.size > MAX_TERMINAL_RECORDS) {
    const oldest = terminalRegistry.keys().next().value as string | undefined;
    if (!oldest) break;
    terminalRegistry.delete(oldest);
  }
}
