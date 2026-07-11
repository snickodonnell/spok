import assert from "node:assert/strict";
import test from "node:test";
import { locateReviewIssuesForFile } from "../../src/lib/review-issue-location";
import type { FileDiff, Session } from "../../src/lib/types";
import type { ReviewIssueMarker } from "../../src/lib/review-queue";

const file: FileDiff = {
  id: "file-1",
  path: "src/app.ts",
  status: "modified",
  language: "typescript",
  additions: 3,
  deletions: 1,
  hunks: [
    {
      id: "hunk-a",
      oldStart: 8,
      oldLines: 3,
      newStart: 8,
      newLines: 4,
      header: "@@ -8,3 +8,4 @@",
      lines: [],
    },
    {
      id: "hunk-b",
      oldStart: 38,
      oldLines: 2,
      newStart: 40,
      newLines: 3,
      header: "@@ -38,2 +40,3 @@",
      lines: [],
    },
  ],
  oldContent: Array.from({ length: 50 }, (_, i) => `old ${i + 1}`).join("\n"),
  newContent: Array.from({ length: 52 }, (_, i) => `new ${i + 1}`).join("\n"),
  relatedTraceIds: ["trace-1"],
  timestamp: 1,
};

function session(): Pick<Session, "nodes" | "reviewComments"> {
  return {
    reviewComments: [
      {
        id: "comment-line",
        path: "src/app.ts",
        line: 41,
        body: "Check this branch",
        author: "user",
        createdAt: 2,
      },
      {
        id: "comment-hunk",
        path: "src/app.ts",
        hunkId: "hunk-a",
        body: "Check this hunk",
        author: "user",
        createdAt: 3,
      },
    ],
    nodes: {
      "trace-1": {
        id: "trace-1",
        parentId: null,
        type: "error",
        title: "Test failure",
        content: "failed",
        timestamp: 4,
        children: [],
        depth: 0,
        links: [
          {
            kind: "file",
            targetId: "file-1",
            path: ".\\src\\app.ts",
            lineStart: 10,
          },
        ],
      },
    },
  };
}

function issue(partial: Partial<ReviewIssueMarker>): ReviewIssueMarker {
  return {
    id: "issue",
    kind: "error",
    severity: "error",
    title: "Issue",
    detail: "detail",
    ...partial,
  };
}

test("locates comments at exact lines and hunk starts", () => {
  const result = locateReviewIssuesForFile(session(), file, [
    issue({ id: "comment:comment-line", kind: "comment", fileId: file.id }),
    issue({ id: "comment:comment-hunk", kind: "comment", path: file.path }),
  ]);

  assert.deepEqual(
    result.map((entry) => ({
      id: entry.issue.id,
      line: entry.lineNumber,
      hunk: entry.hunkIndex,
      precision: entry.precision,
    })),
    [
      {
        id: "comment:comment-hunk",
        line: 8,
        hunk: 0,
        precision: "hunk",
      },
      {
        id: "comment:comment-line",
        line: 41,
        hunk: 1,
        precision: "line",
      },
    ]
  );
});

test("uses trace line links and accepts normalized Windows paths", () => {
  const result = locateReviewIssuesForFile(session(), file, [
    issue({ id: "trace", traceNodeId: "trace-1" }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].lineNumber, 10);
  assert.equal(result[0].hunkIndex, 0);
  assert.equal(result[0].precision, "line");
});

test("falls back to the first changed hunk for file-only issues", () => {
  const result = locateReviewIssuesForFile(session(), file, [
    issue({ id: "conflict", kind: "conflict", fileId: file.id }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].lineNumber, 8);
  assert.equal(result[0].hunkId, "hunk-a");
  assert.equal(result[0].precision, "file");
});

test("ignores issues associated with another file", () => {
  const result = locateReviewIssuesForFile(session(), file, [
    issue({ id: "other", fileId: "file-2", path: "src/other.ts" }),
  ]);

  assert.deepEqual(result, []);
});

