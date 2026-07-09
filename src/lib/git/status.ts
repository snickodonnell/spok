import path from "path";
import { existsSync, statSync, openSync, readSync, closeSync } from "fs";
import {
  decideFilePreview,
  isDeniedSecretPath,
  normalizeRepoRelativePath,
} from "@/lib/security/secrets";
import { canonicalizePath } from "@/lib/security/paths";
import { gitExec, isGitRepo } from "./exec";
import { parsePorcelainStatus, primaryFileState } from "./porcelain";
import {
  findManagedWorktree,
  listManagedWorktrees,
} from "./worktree-registry";
import type {
  GitBranchInfo,
  GitFileEntry,
  GitStatusSnapshot,
  GitWorktreeInfo,
} from "./types";

const BINARY_SAMPLE = 8192;
const MAX_UNTRACKED = 512 * 1024;

function readSample(abs: string, size: number): Buffer {
  const len = Math.min(size, BINARY_SAMPLE);
  const buf = Buffer.alloc(len);
  const fd = openSync(abs, "r");
  try {
    readSync(fd, buf, 0, len, 0);
  } finally {
    closeSync(fd);
  }
  return buf;
}

async function readBranch(cwd: string): Promise<GitBranchInfo> {
  const empty: GitBranchInfo = {
    current: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    headOid: null,
    isDetached: false,
  };

  const head = await gitExec(cwd, ["rev-parse", "--short", "HEAD"], {
    allowFail: true,
    maxBuffer: 4096,
  });
  const headOid = head.code === 0 ? head.stdout.trim() || null : null;

  const symbolic = await gitExec(cwd, ["symbolic-ref", "--short", "-q", "HEAD"], {
    allowFail: true,
    maxBuffer: 4096,
  });

  if (symbolic.code !== 0) {
    return {
      ...empty,
      headOid,
      detached: true,
      isDetached: true,
      current: headOid ? `detached@${headOid}` : "detached",
    };
  }

  const current = symbolic.stdout.trim() || null;

  const upstream = await gitExec(
    cwd,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { allowFail: true, maxBuffer: 4096 }
  );
  const upstreamName =
    upstream.code === 0 ? upstream.stdout.trim() || null : null;

  let ahead = 0;
  let behind = 0;
  if (upstreamName) {
    const counts = await gitExec(
      cwd,
      ["rev-list", "--left-right", "--count", `HEAD...${upstreamName}`],
      { allowFail: true, maxBuffer: 4096 }
    );
    if (counts.code === 0) {
      const parts = counts.stdout.trim().split(/\s+/);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    }
  }

  return {
    current,
    upstream: upstreamName,
    ahead,
    behind,
    detached: false,
    headOid,
    isDetached: false,
  };
}

export async function listWorktrees(cwd: string): Promise<GitWorktreeInfo[]> {
  const r = await gitExec(cwd, ["worktree", "list", "--porcelain"], {
    allowFail: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.code !== 0) return [];

  const managed = listManagedWorktrees();
  const managedPaths = new Set(
    managed.map((m) =>
      canonicalizePath(m.path).replace(/\\/g, "/").toLowerCase()
    )
  );

  const items: GitWorktreeInfo[] = [];
  let current: Partial<GitWorktreeInfo> = {};

  const flush = () => {
    if (current.path) {
      const abs = canonicalizePath(current.path);
      const norm = abs.replace(/\\/g, "/").toLowerCase();
      items.push({
        path: abs,
        branch: current.branch ?? null,
        bare: !!current.bare,
        detached: !!current.detached,
        locked: !!current.locked,
        prunable: !!current.prunable,
        head: current.head ?? null,
        isMain: items.length === 0,
        managedBySpok: managedPaths.has(norm),
      });
    }
    current = {};
  };

  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current.path) flush();
      current.path = line.slice("worktree ".length).trim();
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith("branch ")) {
      const ref = line.slice(7).trim();
      current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    } else if (line === "prunable") {
      current.prunable = true;
    }
  }
  flush();

  // First entry from git is always the main worktree
  if (items.length) items[0].isMain = true;
  for (let i = 1; i < items.length; i++) items[i].isMain = false;

  return items;
}

/**
 * Collect full status snapshot used by Diff + Git panels.
 */
export async function collectGitStatus(cwd: string): Promise<GitStatusSnapshot> {
  const timestamp = Date.now();
  const base: GitStatusSnapshot = {
    cwd,
    repoRoot: cwd,
    isWorktree: false,
    mainWorktreePath: null,
    branch: {
      current: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      detached: false,
      headOid: null,
      isDetached: false,
    },
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
    clean: true,
    skipped: [],
    timestamp,
  };

  if (!(await isGitRepo(cwd))) {
    return { ...base, error: "Not a git repository", clean: true };
  }

  const top = await gitExec(cwd, ["rev-parse", "--show-toplevel"], {
    allowFail: true,
    maxBuffer: 4096,
  });
  const repoRoot = canonicalizePath(
    top.code === 0 ? top.stdout.trim() || cwd : cwd
  );

  const commonDir = await gitExec(cwd, ["rev-parse", "--git-common-dir"], {
    allowFail: true,
    maxBuffer: 4096,
  });
  const gitDir = await gitExec(cwd, ["rev-parse", "--git-dir"], {
    allowFail: true,
    maxBuffer: 4096,
  });

  let mainWorktreePath: string | null = null;
  let isWorktree = false;
  if (commonDir.code === 0 && gitDir.code === 0) {
    const common = path.resolve(cwd, commonDir.stdout.trim());
    const gdir = path.resolve(cwd, gitDir.stdout.trim());
    // Linked worktrees have .git file; common dir is under main/.git
    if (common.toLowerCase() !== gdir.toLowerCase()) {
      isWorktree = true;
      // common is typically <main>/.git — parent is main worktree
      mainWorktreePath = canonicalizePath(path.dirname(common));
    } else {
      mainWorktreePath = repoRoot;
    }
  }

  // Spok registry marks isolation even if git metadata is ambiguous
  const managed = findManagedWorktree(cwd);
  if (managed) {
    isWorktree = true;
    mainWorktreePath = canonicalizePath(managed.mainCheckout);
  }

  const [branch, statusRes] = await Promise.all([
    readBranch(cwd),
    gitExec(cwd, ["status", "--porcelain=v1", "-uall"], {
      allowFail: true,
      maxBuffer: 10 * 1024 * 1024,
    }),
  ]);

  if (statusRes.code !== 0) {
    return {
      ...base,
      repoRoot,
      isWorktree,
      mainWorktreePath,
      branch,
      error: statusRes.stderr || "git status failed",
    };
  }

  const files = parsePorcelainStatus(statusRes.stdout);
  const skipped: Array<{ path: string; reason: string }> = [];

  // Annotate secrets / binary for untracked previews
  for (const f of files) {
    const rel = normalizeRepoRelativePath(f.path);
    if (isDeniedSecretPath(rel)) {
      f.isSecret = true;
      skipped.push({ path: rel, reason: `Secret path denied: ${rel}` });
      continue;
    }
    if (f.areas.includes("untracked")) {
      const abs = path.join(cwd, f.path);
      try {
        if (existsSync(abs) && statSync(abs).isFile()) {
          const size = statSync(abs).size;
          const sample = readSample(abs, size);
          const decision = decideFilePreview({
            relativePath: rel,
            sizeBytes: size,
            maxBytes: MAX_UNTRACKED,
            contentSample: sample,
          });
          if (decision.action === "skip" || decision.action === "deny") {
            if (decision.reason.toLowerCase().includes("binary")) {
              f.isBinary = true;
            }
            skipped.push({ path: rel, reason: decision.reason });
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let conflictCount = 0;
  for (const f of files) {
    if (f.areas.includes("staged")) stagedCount++;
    if (f.areas.includes("unstaged")) unstagedCount++;
    if (f.areas.includes("untracked")) untrackedCount++;
    if (f.areas.includes("conflict")) conflictCount++;
  }

  return {
    cwd,
    repoRoot,
    isWorktree,
    mainWorktreePath,
    branch,
    files,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictCount,
    clean: files.length === 0,
    skipped,
    timestamp,
  };
}

/** Enrich FileDiff-facing display from status entry. */
export function statusLabel(entry: GitFileEntry): string {
  const state = primaryFileState(entry);
  const bits: string[] = [];
  if (entry.areas.includes("staged")) bits.push("staged");
  if (entry.areas.includes("unstaged")) bits.push("unstaged");
  if (entry.areas.includes("untracked")) bits.push("untracked");
  if (entry.areas.includes("conflict")) bits.push("conflict");
  return `${state}${bits.length ? ` (${bits.join("+")})` : ""}`;
}
