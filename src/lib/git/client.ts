"use client";

import { localFetch } from "@/lib/local-api-client";
import { useSpokStore } from "@/lib/store";
import { createFileDiff, parseUnifiedDiff } from "@/lib/diff-utils";
import type {
  GitAction,
  GitActionRequest,
  GitActionResponse,
  GitStatusSnapshot,
  GitWorktreeInfo,
} from "./types";
import type { FileDiff, SessionGitSummary } from "@/lib/types";
import { primaryFileState, toDiffStatus } from "./porcelain";

function summaryFromStatus(s: GitStatusSnapshot): SessionGitSummary {
  return {
    branch: s.branch.current,
    upstream: s.branch.upstream,
    ahead: s.branch.ahead,
    behind: s.branch.behind,
    stagedCount: s.stagedCount,
    unstagedCount: s.unstagedCount,
    untrackedCount: s.untrackedCount,
    conflictCount: s.conflictCount,
    clean: s.clean,
    isWorktree: s.isWorktree,
    mainWorktreePath: s.mainWorktreePath,
    repoRoot: s.repoRoot,
    headOid: s.branch.headOid,
    updatedAt: s.timestamp,
  };
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function flagsFromEntry(entry: {
  areas: string[];
  isBinary?: boolean;
  isSecret?: boolean;
  oldPath?: string;
}): Partial<FileDiff> {
  return {
    staged: entry.areas.includes("staged"),
    unstaged: entry.areas.includes("unstaged"),
    untracked: entry.areas.includes("untracked"),
    conflict: entry.areas.includes("conflict"),
    isBinary: entry.isBinary,
    isSecret: entry.isSecret,
    oldPath: entry.oldPath,
  };
}

/** Fetch structured status and optionally refresh file diffs. */
export async function fetchGitStatus(
  cwd: string,
  opts?: { sessionId?: string; syncDiffs?: boolean }
): Promise<GitStatusSnapshot | null> {
  const res = await localFetch(
    `/api/session/git?cwd=${encodeURIComponent(cwd)}`
  );
  if (!res.ok) return null;
  const status = (await res.json()) as GitStatusSnapshot;

  if (opts?.sessionId) {
    useSpokStore.getState().updateSession(opts.sessionId, {
      gitSummary: summaryFromStatus(status),
    });
  }

  if (opts?.syncDiffs && opts.sessionId) {
    await syncDiffsFromGit(opts.sessionId, cwd, status);
  }

  return status;
}

/**
 * Merge porcelain status + unified diffs into the session file map.
 * Prunes paths no longer present in git status (e.g. after commit).
 */
export async function syncDiffsFromGit(
  sessionId: string,
  cwd: string,
  status?: GitStatusSnapshot | null
): Promise<void> {
  const store = useSpokStore.getState();
  const st =
    status ??
    (await fetchGitStatus(cwd, { sessionId, syncDiffs: false }));
  if (!st) return;

  const byPath = new Map(
    st.files.map((e) => [normPath(e.path), e] as const)
  );
  const keepPaths = new Set(byPath.keys());

  // Content from unified + untracked previews
  const contentByPath = new Map<
    string,
    { oldContent?: string; newContent?: string; status?: string }
  >();

  const diffRes = await localFetch(
    `/api/session/git-diff?cwd=${encodeURIComponent(cwd)}`
  );
  if (diffRes.ok) {
    const data = (await diffRes.json()) as {
      diff?: string;
      files?: Array<{
        path: string;
        status: string;
        oldContent?: string;
        newContent?: string;
        skipped?: boolean;
        reason?: string;
      }>;
    };

    if (data.diff) {
      for (const f of parseUnifiedDiff(data.diff)) {
        contentByPath.set(normPath(f.path), {
          oldContent: f.oldContent,
          newContent: f.newContent,
          status: f.status,
        });
        // Also capture under oldPath for renames if needed
        if (f.oldPath) {
          // content keyed by new path only
        }
      }
    }

    for (const f of data.files ?? []) {
      const key = normPath(f.path);
      if (f.newContent == null && f.oldContent == null) continue;
      contentByPath.set(key, {
        oldContent: f.oldContent ?? "",
        newContent: f.newContent ?? "",
        status: f.status,
      });
    }
  }

  // Upsert every status path once with best content + flags
  for (const entry of st.files) {
    const key = normPath(entry.path);
    const content = contentByPath.get(key);
    const flags = flagsFromEntry(entry);
    const statusLabel = toDiffStatus(primaryFileState(entry));

    if (content) {
      const fd = createFileDiff({
        path: entry.path,
        oldPath: entry.oldPath,
        oldContent: content.oldContent ?? "",
        newContent: content.newContent ?? "",
        status: statusLabel,
      });
      store.upsertFileDiff(sessionId, {
        ...fd,
        ...flags,
        status: statusLabel,
        isBinary: entry.isBinary || fd.isBinary,
        isSecret: entry.isSecret,
      });
    } else if (entry.isBinary || entry.isSecret) {
      const fd = createFileDiff({
        path: entry.path,
        oldPath: entry.oldPath,
        oldContent: "",
        newContent: entry.isSecret
          ? "// Secret path — content not shown\n"
          : "// Binary file — content not shown\n",
        status: statusLabel,
      });
      store.upsertFileDiff(sessionId, {
        ...fd,
        ...flags,
        isBinary: !!entry.isBinary,
        isSecret: !!entry.isSecret,
      });
    } else {
      // Status-only entry (tracked change without reconstructed content yet)
      const existing = Object.values(
        useSpokStore.getState().sessions[sessionId]?.files ?? {}
      ).find((f) => normPath(f.path) === key);

      if (existing) {
        store.upsertFileDiff(sessionId, {
          ...existing,
          ...flags,
          status: statusLabel,
          oldPath: entry.oldPath ?? existing.oldPath,
        });
      } else {
        // Placeholder so Git panel lists the path immediately
        const fd = createFileDiff({
          path: entry.path,
          oldPath: entry.oldPath,
          oldContent: "",
          newContent: "",
          status: statusLabel,
        });
        store.upsertFileDiff(sessionId, { ...fd, ...flags });
      }
    }
  }

  // Remove files no longer dirty in the working tree
  store.pruneFileDiffs(sessionId, keepPaths);

  store.updateSession(sessionId, { gitSummary: summaryFromStatus(st) });
}

export async function gitAction(
  req: GitActionRequest
): Promise<GitActionResponse> {
  const session = req.sessionId
    ? useSpokStore.getState().sessions[req.sessionId]
    : null;

  const isolationGuard =
    req.isolationGuard ?? session?.config.isolationGuard ?? false;
  const mainCheckout =
    req.mainCheckout ?? session?.config.mainCheckout ?? undefined;

  const res = await localFetch("/api/session/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...req,
      isolationGuard,
      mainCheckout,
    }),
  });

  let data: GitActionResponse;
  try {
    data = (await res.json()) as GitActionResponse;
  } catch {
    data = {
      ok: false,
      action: req.action,
      error: `Git request failed (${res.status})`,
    };
  }

  // Surface HTTP policy errors when body is sparse
  if (!res.ok && !data.error) {
    data = {
      ...data,
      ok: false,
      action: req.action,
      error: data.error || `Git request failed (${res.status})`,
    };
  }

  if (data.status && req.sessionId) {
    useSpokStore.getState().updateSession(req.sessionId, {
      gitSummary: summaryFromStatus(data.status),
    });
  }

  return data;
}

export async function runGitAndRefresh(
  sessionId: string,
  cwd: string,
  action: GitAction,
  extra?: Partial<GitActionRequest>
): Promise<GitActionResponse> {
  const result = await gitAction({
    action,
    cwd,
    sessionId,
    ...extra,
  });

  // Always resync after successful mutations; also when status payload present
  if (result.ok) {
    await syncDiffsFromGit(sessionId, cwd, result.status ?? null);
  } else if (result.status) {
    // Failed commit etc. may still return status
    await syncDiffsFromGit(sessionId, cwd, result.status);
  }

  return result;
}

export async function listWorktreesClient(
  cwd: string
): Promise<GitWorktreeInfo[]> {
  const r = await gitAction({ action: "worktree_list", cwd });
  return r.worktrees ?? [];
}
