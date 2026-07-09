import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ensureSpokHome } from "@/lib/spok-paths";
import { canonicalizePath } from "@/lib/security/paths";

/**
 * Durable registry of Spok-managed worktrees so we can:
 * - mark isolation in the UI
 * - refuse background tasks from mutating the main checkout
 * - clean up orphaned registrations
 */

export type ManagedWorktreeRecord = {
  id: string;
  /** Absolute path of the linked worktree. */
  path: string;
  /** Absolute path of the main checkout that spawned it. */
  mainCheckout: string;
  branch: string | null;
  sessionId?: string;
  createdAt: number;
  label?: string;
};

function registryPath(): string {
  return path.join(ensureSpokHome(), "worktrees.json");
}

function loadAll(): ManagedWorktreeRecord[] {
  try {
    const p = registryPath();
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      worktrees?: ManagedWorktreeRecord[];
    };
    return Array.isArray(raw.worktrees) ? raw.worktrees : [];
  } catch {
    return [];
  }
}

function saveAll(worktrees: ManagedWorktreeRecord[]): void {
  try {
    const home = ensureSpokHome();
    if (!existsSync(home)) mkdirSync(home, { recursive: true });
    writeFileSync(
      registryPath(),
      JSON.stringify({ version: 1, worktrees }, null, 2),
      "utf8"
    );
  } catch {
    /* non-fatal */
  }
}

export function listManagedWorktrees(): ManagedWorktreeRecord[] {
  return loadAll();
}

export function findManagedWorktree(
  worktreePath: string
): ManagedWorktreeRecord | undefined {
  const c = canonicalizePath(worktreePath);
  return loadAll().find(
    (w) => canonicalizePath(w.path).toLowerCase() === c.toLowerCase()
  );
}

export function isManagedWorktreePath(worktreePath: string): boolean {
  return !!findManagedWorktree(worktreePath);
}

export function registerManagedWorktree(
  record: Omit<ManagedWorktreeRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  }
): ManagedWorktreeRecord {
  const all = loadAll().filter(
    (w) =>
      canonicalizePath(w.path).toLowerCase() !==
      canonicalizePath(record.path).toLowerCase()
  );
  const entry: ManagedWorktreeRecord = {
    id: record.id ?? `wt_${Date.now().toString(36)}`,
    path: canonicalizePath(record.path),
    mainCheckout: canonicalizePath(record.mainCheckout),
    branch: record.branch,
    sessionId: record.sessionId,
    createdAt: record.createdAt ?? Date.now(),
    label: record.label,
  };
  all.push(entry);
  saveAll(all);
  return entry;
}

export function unregisterManagedWorktree(worktreePath: string): boolean {
  const c = canonicalizePath(worktreePath).toLowerCase();
  const all = loadAll();
  const next = all.filter((w) => canonicalizePath(w.path).toLowerCase() !== c);
  if (next.length === all.length) return false;
  saveAll(next);
  return true;
}

/**
 * When isolationGuard is on, write/destructive ops must not target the main
 * checkout path. Read ops are allowed from anywhere.
 */
export function assertWorktreeIsolation(opts: {
  cwd: string;
  mainCheckout?: string | null;
  isolationGuard?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.isolationGuard) return { ok: true };
  if (!opts.mainCheckout?.trim()) return { ok: true };
  return assertNotMainCheckout({
    cwd: opts.cwd,
    mainCheckout: opts.mainCheckout,
  });
}

/**
 * Refuse write ops when cwd is the main checkout (background worktree sessions).
 */
export function assertNotMainCheckout(opts: {
  cwd: string;
  mainCheckout: string;
}): { ok: true } | { ok: false; reason: string } {
  const cwd = canonicalizePath(opts.cwd).toLowerCase();
  const main = canonicalizePath(opts.mainCheckout).toLowerCase();
  if (cwd === main) {
    return {
      ok: false,
      reason:
        "A background worktree task cannot modify the local main checkout. Run this action inside the worktree path.",
    };
  }
  return { ok: true };
}

function pathKey(p: string): string {
  return canonicalizePath(p).replace(/\\/g, "/").toLowerCase();
}

/** Compare worktree paths across Windows/POSIX separators. */
export function worktreePathsEqual(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}
