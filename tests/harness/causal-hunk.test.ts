import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFileChangeLinks,
  getCausalStepsForHunk,
  hunkSignatureLines,
  scoreNodeForHunk,
} from "../../src/lib/causal-links";
import { createFileDiff } from "../../src/lib/diff-utils";
import type { DiffHunk, FileDiff, TraceNode } from "../../src/lib/types";

function hunk(partial: Partial<DiffHunk> & Pick<DiffHunk, "id">): DiffHunk {
  return {
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    header: "@@ -1,1 +1,1 @@",
    lines: [{ type: "add", content: "const x = 1;", newLineNumber: 1 }],
    ...partial,
  };
}

function node(partial: Partial<TraceNode> & Pick<TraceNode, "id" | "type">): TraceNode {
  return {
    parentId: null,
    title: partial.title ?? partial.type,
    content: "",
    timestamp: partial.timestamp ?? 1,
    children: [],
    links: [],
    depth: 0,
    ...partial,
  };
}

function file(partial: Partial<FileDiff> & Pick<FileDiff, "id" | "path">): FileDiff {
  return {
    status: "modified",
    language: "ts",
    additions: 1,
    deletions: 0,
    hunks: [],
    relatedTraceIds: [],
    timestamp: 1,
    ...partial,
  };
}

describe("per-hunk causality", () => {
  it("buildFileChangeLinks emits file + hunk line ranges", () => {
    const fd = createFileDiff({
      path: "src/a.ts",
      oldContent: "a\nb\nc\n",
      newContent: "a\nB\nc\nD\n",
    });
    const links = buildFileChangeLinks(fd, "src/a.ts");
    assert.ok(links.some((l) => l.kind === "file"));
    const hunkLinks = links.filter((l) => l.kind === "hunk");
    assert.ok(hunkLinks.length >= 1);
    assert.ok(hunkLinks.every((l) => l.lineStart != null && l.targetId));
  });

  it("scores explicit hunk links highest", () => {
    const h = hunk({ id: "h1", newStart: 10, newLines: 3 });
    const f = file({
      id: "f1",
      path: "src/a.ts",
      hunks: [h],
    });
    const n = node({
      id: "t1",
      type: "file_change",
      links: [{ kind: "hunk", targetId: "h1", path: "src/a.ts", lineStart: 10, lineEnd: 12 }],
    });
    const { score, reason } = scoreNodeForHunk(n, f, h, 0, 0, 1);
    assert.ok(score >= 90);
    assert.ok(reason.length > 0);
  });

  it("matches hunk content signatures", () => {
    const h = hunk({
      id: "h1",
      lines: [
        { type: "remove", content: "export function oldName() {}", oldLineNumber: 1 },
        { type: "add", content: "export function newName() {}", newLineNumber: 1 },
      ],
    });
    assert.ok(hunkSignatureLines(h).some((s) => s.includes("newName")));

    const f = file({ id: "f1", path: "src/a.ts", hunks: [h] });
    const n = node({
      id: "t1",
      type: "tool_call",
      toolName: "search_replace",
      content: "Renamed to export function newName() {}",
    });
    const { score } = scoreNodeForHunk(n, f, h, 0, null, 0);
    assert.ok(score >= 45);
  });

  it("zips sequential file_change nodes to hunk order", () => {
    const h0 = hunk({ id: "h0", newStart: 1, newLines: 2 });
    const h1 = hunk({ id: "h1", newStart: 40, newLines: 2 });
    const f = file({
      id: "f1",
      path: "src/a.ts",
      hunks: [h0, h1],
      relatedTraceIds: ["fc0", "fc1"],
    });
    const nodes = {
      fc0: node({
        id: "fc0",
        type: "file_change",
        timestamp: 10,
        title: "first edit",
        links: [{ kind: "file", targetId: "f1", path: "src/a.ts" }],
      }),
      fc1: node({
        id: "fc1",
        type: "file_change",
        timestamp: 20,
        title: "second edit",
        links: [{ kind: "file", targetId: "f1", path: "src/a.ts" }],
      }),
    };
    const session = {
      nodes,
      files: { f1: f },
      reviewComments: [],
    };
    const b0 = getCausalStepsForHunk(session, "f1", 0);
    const b1 = getCausalStepsForHunk(session, "f1", 1);
    assert.ok(b0 && b1);
    assert.equal(b0!.hunkId, "h0");
    assert.equal(b1!.hunkId, "h1");
    // First file_change should rank high for hunk 0
    const top0 = b0!.hunkSteps[0] || b0!.steps[0];
    const top1 = b1!.hunkSteps[0] || b1!.steps[0];
    assert.equal(top0.nodeId, "fc0");
    assert.equal(top1.nodeId, "fc1");
  });
});
