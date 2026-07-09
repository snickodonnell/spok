import type { GitChangeArea, GitFileEntry, GitFileState } from "./types";

/**
 * Map a single porcelain XY status character to a semantic state.
 * @see https://git-scm.com/docs/git-status#_short_format
 */
export function mapStatusChar(ch: string): GitFileState {
  switch (ch) {
    case " ":
      return "unchanged";
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "T":
      return "typechange";
    case "?":
      return "untracked";
    case "!":
      return "ignored";
    default:
      return "modified";
  }
}

function unquotePath(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/**
 * Parse `git status --porcelain=v1 -uall` into structured entries.
 * Handles renames (`R  old -> new`) and unmerged codes.
 */
export function parsePorcelainStatus(statusText: string): GitFileEntry[] {
  const entries: GitFileEntry[] = [];
  const lines = statusText.split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.length < 2) continue;
    const code = line.slice(0, 2);
    let rest = line.slice(3);

    let path = rest;
    let oldPath: string | undefined;

    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      oldPath = unquotePath(parts[0] ?? "");
      path = unquotePath(parts.slice(1).join(" -> "));
    } else {
      path = unquotePath(rest);
    }

    path = path.replace(/\\/g, "/");
    if (oldPath) oldPath = oldPath.replace(/\\/g, "/");

    const indexStatus = mapStatusChar(code[0] ?? " ");
    const worktreeStatus = mapStatusChar(code[1] ?? " ");
    const areas: GitChangeArea[] = [];

    if (code === "??") {
      areas.push("untracked");
    } else if (code.includes("U") || code === "AA" || code === "DD") {
      areas.push("conflict");
    } else {
      if (code[0] !== " " && code[0] !== "?") areas.push("staged");
      if (code[1] !== " " && code[1] !== "?") areas.push("unstaged");
      // Untracked half-states
      if (code[0] === "?" || code[1] === "?") {
        if (!areas.includes("untracked")) areas.push("untracked");
      }
    }

    if (areas.length === 0) continue;

    entries.push({
      path,
      oldPath,
      indexStatus: code === "??" ? "untracked" : indexStatus,
      worktreeStatus: code === "??" ? "untracked" : worktreeStatus,
      areas,
      code,
      modeChange: code.includes("T"),
    });
  }

  return entries;
}

/** Prefer a single display status for badges. */
export function primaryFileState(entry: GitFileEntry): GitFileState {
  if (entry.areas.includes("conflict")) return "unmerged";
  if (entry.areas.includes("untracked")) return "untracked";
  if (entry.indexStatus === "renamed" || entry.worktreeStatus === "renamed")
    return "renamed";
  if (entry.indexStatus === "deleted" || entry.worktreeStatus === "deleted")
    return "deleted";
  if (entry.indexStatus === "added" || entry.worktreeStatus === "added")
    return "added";
  if (entry.indexStatus === "modified" || entry.worktreeStatus === "modified")
    return "modified";
  return entry.worktreeStatus !== "unchanged"
    ? entry.worktreeStatus
    : entry.indexStatus;
}

export function toDiffStatus(
  state: GitFileState
): "added" | "modified" | "deleted" | "renamed" | "unchanged" {
  switch (state) {
    case "added":
    case "untracked":
    case "copied":
      return "added";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "unchanged":
      return "unchanged";
    default:
      return "modified";
  }
}
