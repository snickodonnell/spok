import type { ReviewIssueMarker } from "./review-queue";
import type { DiffHunk, FileDiff, Session, TraceLink } from "./types";

export interface LocatedReviewIssue {
  issue: ReviewIssueMarker;
  /** 1-based line in the modified editor. */
  lineNumber: number;
  hunkIndex: number;
  hunkId?: string;
  /** Whether the location was exact or a file-level fallback. */
  precision: "line" | "hunk" | "file";
}

function normalizePath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathMatches(file: FileDiff, path: string | undefined): boolean {
  const target = normalizePath(path);
  if (!target) return false;
  return target === normalizePath(file.path) || target === normalizePath(file.oldPath);
}

function hunkForLine(hunks: DiffHunk[], line: number): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hunks.length; index += 1) {
    const hunk = hunks[index];
    const start = Math.max(1, hunk.newStart || 1);
    const end = Math.max(start, start + Math.max(1, hunk.newLines) - 1);
    if (line >= start && line <= end) return index;
    const distance = Math.min(Math.abs(line - start), Math.abs(line - end));
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function hunkFromLink(file: FileDiff, link: TraceLink): number | undefined {
  if (link.kind === "hunk") {
    const index = file.hunks.findIndex((hunk) => hunk.id === link.targetId);
    if (index >= 0) return index;
  }
  if (link.lineStart != null && (pathMatches(file, link.path) || link.targetId === file.id)) {
    return hunkForLine(file.hunks, link.lineStart);
  }
  return undefined;
}

function clampLine(file: FileDiff, line: number): number {
  const lineCount = Math.max(1, (file.newContent ?? "").split("\n").length);
  return Math.max(1, Math.min(lineCount, line));
}

/**
 * Resolve review issues to the best available modified-file location.
 *
 * Exact review-comment lines win, followed by hunk ids and trace links. File-only
 * issues stay actionable by landing on the first changed hunk. This is pure and is
 * intended to run only when the session issue set or selected file changes.
 */
export function locateReviewIssuesForFile(
  session: Pick<Session, "nodes" | "reviewComments">,
  file: FileDiff,
  issues: readonly ReviewIssueMarker[]
): LocatedReviewIssue[] {
  const located: LocatedReviewIssue[] = [];

  for (const issue of issues) {
    const trace = issue.traceNodeId ? session.nodes[issue.traceNodeId] : undefined;
    const traceLinks = trace?.links ?? [];
    const traceTargetsFile = traceLinks.some(
      (link) =>
        link.targetId === file.id ||
        pathMatches(file, link.path) ||
        (link.kind === "hunk" && file.hunks.some((hunk) => hunk.id === link.targetId))
    );
    if (issue.fileId !== file.id && !pathMatches(file, issue.path) && !traceTargetsFile) {
      continue;
    }

    const commentId = issue.kind === "comment" && issue.id.startsWith("comment:")
      ? issue.id.slice("comment:".length)
      : undefined;
    const comment = commentId
      ? session.reviewComments?.find((candidate) => candidate.id === commentId)
      : undefined;

    let hunkIndex: number | undefined;
    let lineNumber: number | undefined;
    let precision: LocatedReviewIssue["precision"] = "file";

    if (comment?.line != null) {
      lineNumber = comment.line;
      hunkIndex = hunkForLine(file.hunks, comment.line);
      precision = "line";
    } else if (comment?.hunkId) {
      const index = file.hunks.findIndex((hunk) => hunk.id === comment.hunkId);
      if (index >= 0) {
        hunkIndex = index;
        lineNumber = Math.max(1, file.hunks[index].newStart || 1);
        precision = "hunk";
      }
    }

    if (lineNumber == null) {
      for (const link of traceLinks) {
        if (
          link.lineStart != null &&
          (pathMatches(file, link.path) || link.targetId === file.id)
        ) {
          lineNumber = link.lineStart;
          hunkIndex = hunkForLine(file.hunks, link.lineStart);
          precision = "line";
          break;
        }
        const linkedHunk = hunkFromLink(file, link);
        if (linkedHunk != null) {
          hunkIndex = linkedHunk;
          lineNumber = Math.max(1, file.hunks[linkedHunk].newStart || 1);
          precision = "hunk";
          break;
        }
      }
    }

    if (lineNumber == null) {
      hunkIndex = 0;
      lineNumber = Math.max(1, file.hunks[0]?.newStart || 1);
    }

    const safeHunkIndex = file.hunks.length
      ? Math.max(0, Math.min(file.hunks.length - 1, hunkIndex ?? 0))
      : 0;
    located.push({
      issue,
      lineNumber: clampLine(file, lineNumber),
      hunkIndex: safeHunkIndex,
      hunkId: file.hunks[safeHunkIndex]?.id,
      precision,
    });
  }

  return located.sort((a, b) => {
    if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
    const severity = { error: 0, warn: 1, info: 2 } as const;
    return severity[a.issue.severity] - severity[b.issue.severity];
  });
}

