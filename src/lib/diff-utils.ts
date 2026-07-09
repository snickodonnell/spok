import { nanoid } from "nanoid";
import type { DiffHunk, DiffLine, DiffStatus, FileDiff, FileTreeNode } from "./types";
import { languageFromPath } from "./language";

export function computeLineDiff(
  oldText: string,
  newText: string
): { hunks: DiffHunk[]; additions: number; deletions: number } {
  const oldLines = oldText.length ? oldText.split("\n") : [];
  const newLines = newText.length ? newText.split("\n") : [];

  // LCS-based line diff (Myers simplified for moderate files)
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  type Op = { kind: "eq" | "add" | "del"; old?: string; neu?: string; oi?: number; ni?: number };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ kind: "eq", old: oldLines[i - 1], neu: newLines[j - 1], oi: i, ni: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: "add", neu: newLines[j - 1], ni: j });
      j--;
    } else {
      ops.push({ kind: "del", old: oldLines[i - 1], oi: i });
      i--;
    }
  }
  ops.reverse();

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.kind === "eq") {
      lines.push({
        type: "context",
        content: op.old ?? "",
        oldLineNumber: op.oi,
        newLineNumber: op.ni,
      });
    } else if (op.kind === "add") {
      additions++;
      lines.push({ type: "add", content: op.neu ?? "", newLineNumber: op.ni });
    } else {
      deletions++;
      lines.push({ type: "remove", content: op.old ?? "", oldLineNumber: op.oi });
    }
  }

  // Group into hunks with context window of 3 around changes
  const hunks = groupIntoHunks(lines);
  return { hunks, additions, deletions };
}

function groupIntoHunks(lines: DiffLine[]): DiffHunk[] {
  if (lines.length === 0) return [];

  const changeIdx: number[] = [];
  lines.forEach((l, idx) => {
    if (l.type !== "context") changeIdx.push(idx);
  });
  if (changeIdx.length === 0) {
    return [
      {
        id: nanoid(8),
        oldStart: 1,
        oldLines: lines.filter((l) => l.type !== "add").length,
        newStart: 1,
        newLines: lines.filter((l) => l.type !== "remove").length,
        header: `@@ -1,${lines.length} +1,${lines.length} @@`,
        lines,
      },
    ];
  }

  const CONTEXT = 3;
  const ranges: Array<{ start: number; end: number }> = [];
  let start = Math.max(0, changeIdx[0] - CONTEXT);
  let end = Math.min(lines.length - 1, changeIdx[0] + CONTEXT);
  for (let k = 1; k < changeIdx.length; k++) {
    const c = changeIdx[k];
    const cStart = Math.max(0, c - CONTEXT);
    if (cStart <= end + 1) {
      end = Math.min(lines.length - 1, c + CONTEXT);
    } else {
      ranges.push({ start, end });
      start = cStart;
      end = Math.min(lines.length - 1, c + CONTEXT);
    }
  }
  ranges.push({ start, end });

  return ranges.map((r) => {
    const slice = lines.slice(r.start, r.end + 1);
    const oldLines = slice.filter((l) => l.type !== "add");
    const newLines = slice.filter((l) => l.type !== "remove");
    const oldStart = oldLines.find((l) => l.oldLineNumber)?.oldLineNumber ?? 1;
    const newStart = newLines.find((l) => l.newLineNumber)?.newLineNumber ?? 1;
    return {
      id: nanoid(8),
      oldStart,
      oldLines: oldLines.length,
      newStart,
      newLines: newLines.length,
      header: `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
      lines: slice,
    };
  });
}

export function createFileDiff(opts: {
  path: string;
  oldContent?: string;
  newContent?: string;
  status?: DiffStatus;
  relatedTraceIds?: string[];
  oldPath?: string;
  timestamp?: number;
}): FileDiff {
  const oldContent = opts.oldContent ?? "";
  const newContent = opts.newContent ?? "";
  let status: DiffStatus = opts.status ?? "modified";
  if (!oldContent && newContent) status = "added";
  if (oldContent && !newContent) status = "deleted";
  if (opts.oldPath && opts.oldPath !== opts.path) status = "renamed";

  const { hunks, additions, deletions } = computeLineDiff(oldContent, newContent);

  return {
    id: nanoid(10),
    path: opts.path,
    oldPath: opts.oldPath,
    status,
    language: languageFromPath(opts.path),
    additions,
    deletions,
    hunks,
    oldContent,
    newContent,
    relatedTraceIds: opts.relatedTraceIds ?? [],
    timestamp: opts.timestamp ?? Date.now(),
  };
}

export function buildFileTree(files: FileDiff[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const file of Object.values(files).sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split(/[/\\]/).filter(Boolean);
    let current = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = current.find((n) => n.name === part);
      if (!node) {
        node = {
          name: part,
          path: acc,
          type: isFile ? "file" : "directory",
          children: isFile ? undefined : [],
        };
        current.push(node);
      }
      if (isFile) {
        node.type = "file";
        node.status = file.status;
        node.additions = file.additions;
        node.deletions = file.deletions;
        node.fileId = file.id;
      } else {
        current = node.children!;
      }
    }
  }

  // Roll up stats
  function rollup(nodes: FileTreeNode[]): { add: number; del: number } {
    let add = 0;
    let del = 0;
    for (const n of nodes) {
      if (n.type === "file") {
        add += n.additions ?? 0;
        del += n.deletions ?? 0;
      } else if (n.children) {
        const r = rollup(n.children);
        n.additions = r.add;
        n.deletions = r.del;
        // Derive status from children
        const statuses = new Set(n.children.map((c) => c.status).filter(Boolean));
        if (statuses.size === 1) n.status = [...statuses][0];
        else if (statuses.size > 1) n.status = "modified";
        add += r.add;
        del += r.del;
      }
    }
    return { add, del };
  }
  rollup(root);
  return root;
}

export function unifiedDiffText(file: FileDiff): string {
  const lines: string[] = [
    `diff --git a/${file.path} b/${file.path}`,
    `--- a/${file.oldPath ?? file.path}`,
    `+++ b/${file.path}`,
  ];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      lines.push(prefix + line.content);
    }
  }
  return lines.join("\n");
}

export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const blocks = diffText.split(/^diff --git /m).filter(Boolean);

  for (const block of blocks) {
    const text = block.startsWith("a/") ? "diff --git " + block : block;
    const pathMatch = text.match(/diff --git a\/(.+?) b\/(.+?)(?:\n|$)/);
    if (!pathMatch) continue;
    const oldPath = pathMatch[1].trim();
    const newPath = pathMatch[2].trim();

    const oldLines: string[] = [];
    const newLines: string[] = [];
    const body = text.split("\n").slice(1);
    for (const line of body) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") || line.startsWith("@@")) {
        continue;
      }
      if (line.startsWith("+")) {
        newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
      } else if (line.startsWith(" ") || line === "") {
        const c = line.startsWith(" ") ? line.slice(1) : line;
        oldLines.push(c);
        newLines.push(c);
      }
    }

    files.push(
      createFileDiff({
        path: newPath === "/dev/null" ? oldPath : newPath,
        oldPath: oldPath === "/dev/null" ? undefined : oldPath,
        oldContent: oldPath === "/dev/null" ? "" : oldLines.join("\n"),
        newContent: newPath === "/dev/null" ? "" : newLines.join("\n"),
      })
    );
  }

  return files;
}
