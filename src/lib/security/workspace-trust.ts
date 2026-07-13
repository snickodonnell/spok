import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { canonicalizePath, isPathInsideRoot } from "./paths";
import { ensureSpokHome, getSpokHome } from "@/lib/spok-paths";
import { appendAuditEvent } from "./audit";

/**
 * Durable trusted workspace root registry.
 *
 * Persists to `~/.spok/workspace-trust.json` (or `$SPOK_HOME/workspace-trust.json`)
 * so trust survives process restarts and stays coherent across Spok processes
 * (standalone runtime vs residual Next API). Durable file is authority for
 * already-persisted roots; in-memory is a cache that reloads when the file's
 * mtime/size changes. Refresh never grants trust, broadens roots, or skips
 * canonicalizePath — it only re-reads what was already written.
 *
 * Schema v1:
 * `{ "version": 1, "roots": [{ "path": string, "trustedAt": number }] }`
 *
 * Paths are stored and compared via `canonicalizePath`.
 */

export const WORKSPACE_TRUST_SCHEMA_VERSION = 1 as const;

export type TrustedRootEntry = {
  /** Canonical absolute path */
  path: string;
  /** Epoch ms when the user (or host) trusted this root */
  trustedAt: number;
};

type TrustFileV1 = {
  version: typeof WORKSPACE_TRUST_SCHEMA_VERSION;
  roots: TrustedRootEntry[];
};

/** Observed durable-file identity for cross-process cache invalidation. */
type DiskStamp = {
  mtimeMs: number;
  size: number;
};

/** path → trustedAt */
const trustedRoots = new Map<string, number>();
let loaded = false;
/** Stamp of the trust file last applied to `trustedRoots`; null if absent. */
let diskStamp: DiskStamp | null = null;

export function getWorkspaceTrustFilePath(): string {
  return path.join(getSpokHome(), "workspace-trust.json");
}

function readDiskStamp(): DiskStamp | null {
  const file = getWorkspaceTrustFilePath();
  try {
    if (!existsSync(file)) return null;
    const st = statSync(file);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function stampsEqual(a: DiskStamp | null, b: DiskStamp | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * Ensure in-memory roots match durable disk state.
 * Reloads when never loaded or when another process rewrote the trust file.
 * Does not invent roots — only materializes already-persisted entries.
 */
function ensureLoaded(): void {
  const stamp = readDiskStamp();
  if (loaded && stampsEqual(stamp, diskStamp)) return;
  loaded = true;
  loadFromDisk();
  diskStamp = readDiskStamp();
}

function loadFromDisk(): void {
  trustedRoots.clear();
  const file = getWorkspaceTrustFilePath();
  if (!existsSync(file)) return;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrustFileV1>;
    if (parsed.version !== 1 || !Array.isArray(parsed.roots)) return;
    for (const entry of parsed.roots) {
      if (!entry || typeof entry.path !== "string" || !entry.path.trim()) {
        continue;
      }
      const p = canonicalizePath(entry.path);
      const at =
        typeof entry.trustedAt === "number" && Number.isFinite(entry.trustedAt)
          ? entry.trustedAt
          : Date.now();
      trustedRoots.set(p, at);
    }
  } catch {
    /* corrupt file: start empty; next write will repair */
  }
}

function persistToDisk(): void {
  try {
    ensureSpokHome();
    const file = getWorkspaceTrustFilePath();
    const payload: TrustFileV1 = {
      version: WORKSPACE_TRUST_SCHEMA_VERSION,
      roots: [...trustedRoots.entries()]
        .map(([p, trustedAt]) => ({ path: p, trustedAt }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
    const dir = path.dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    renameSync(tmp, file);
    diskStamp = readDiskStamp();
  } catch {
    /* never break privileged path on trust I/O failure */
  }
}

/** Force re-read from disk (tests / after external edit). */
export function reloadTrustedRootsFromDisk(): void {
  loaded = true;
  loadFromDisk();
  diskStamp = readDiskStamp();
}

/**
 * Reset in-memory trust and persist empty list.
 * Used by tests; also available if the product needs a full wipe.
 */
export function clearTrustedRoots(): void {
  loaded = true;
  trustedRoots.clear();
  persistToDisk();
}

export function listTrustedRootEntries(): TrustedRootEntry[] {
  ensureLoaded();
  return [...trustedRoots.entries()]
    .map(([p, trustedAt]) => ({ path: p, trustedAt }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function listTrustedRoots(): string[] {
  return listTrustedRootEntries().map((e) => e.path);
}

/**
 * Mark a directory as trusted. Idempotent: re-trusting keeps earlier trustedAt.
 * Returns the canonical path.
 */
export function trustWorkspaceRoot(rawPath: string): string {
  ensureLoaded();
  const root = canonicalizePath(rawPath);
  if (!trustedRoots.has(root)) {
    trustedRoots.set(root, Date.now());
    persistToDisk();
    try {
      appendAuditEvent({
        type: "workspace_trust",
        timestamp: Date.now(),
        action: "trust",
        cwd: root,
        paths: [root],
        decision: "allowed",
        details: { root },
      });
    } catch {
      /* audit is best-effort */
    }
  }
  return root;
}

/**
 * Remove a previously trusted root. Returns true if it was present.
 * Does not cascade-delete nested path checks — child paths simply lose their root.
 */
export function revokeTrustedRoot(rawPath: string): boolean {
  ensureLoaded();
  const root = canonicalizePath(rawPath);
  const had = trustedRoots.delete(root);
  if (had) {
    persistToDisk();
    try {
      appendAuditEvent({
        type: "workspace_trust",
        timestamp: Date.now(),
        action: "revoke",
        cwd: root,
        paths: [root],
        decision: "deny",
        details: { root },
      });
    } catch {
      /* audit is best-effort */
    }
  }
  return had;
}

export function isTrustedWorkspacePath(rawPath: string): boolean {
  ensureLoaded();
  if (!trustedRoots.size) return false;
  const candidate = canonicalizePath(rawPath);
  for (const root of trustedRoots.keys()) {
    if (isPathInsideRoot(candidate, root)) return true;
  }
  return false;
}

export function findTrustedRoot(rawPath: string): string | null {
  ensureLoaded();
  const candidate = canonicalizePath(rawPath);
  for (const root of trustedRoots.keys()) {
    if (isPathInsideRoot(candidate, root)) return root;
  }
  return null;
}

export type TrustCheckResult =
  | { ok: true; root: string; path: string }
  | { ok: false; path: string; reason: string };

export function requireTrustedCwd(
  rawCwd: string | null | undefined
): TrustCheckResult {
  if (!rawCwd || !rawCwd.trim()) {
    return {
      ok: false,
      path: rawCwd ?? "",
      reason: "Working directory is required",
    };
  }
  const pathCanon = canonicalizePath(rawCwd);
  const root = findTrustedRoot(pathCanon);
  if (!root) {
    return {
      ok: false,
      path: pathCanon,
      reason:
        "Working directory is outside trusted workspace roots. Open the repo in Spok to trust it first.",
    };
  }
  return { ok: true, root, path: pathCanon };
}
