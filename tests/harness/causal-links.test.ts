import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCausalStepsForFile,
  getFilesForTrace,
  causalKindLabel,
} from "../../src/lib/causal-links";
import type { FileDiff, Session, TraceNode } from "../../src/lib/types";

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

function session(
  nodes: TraceNode[],
  files: FileDiff[],
  comments: Session["reviewComments"] = []
): Pick<Session, "nodes" | "files" | "reviewComments"> {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    files: Object.fromEntries(files.map((f) => [f.id, f])),
    reviewComments: comments,
  };
}

describe("causal links", () => {
  it("returns null for unknown file", () => {
    const s = session([], []);
    assert.equal(getCausalStepsForFile(s, "missing"), null);
  });

  it("collects direct relatedTraceIds in time order", () => {
    const s = session(
      [
        node({
          id: "t2",
          type: "tool_call",
          title: "write",
          toolName: "write",
          timestamp: 20,
        }),
        node({
          id: "t1",
          type: "thinking",
          title: "plan edit",
          content: "I will fix the bug",
          timestamp: 10,
        }),
      ],
      [
        file({
          id: "f1",
          path: "src/a.ts",
          relatedTraceIds: ["t2", "t1"],
        }),
      ]
    );
    const bundle = getCausalStepsForFile(s, "f1");
    assert.ok(bundle);
    assert.equal(bundle!.path, "src/a.ts");
    assert.equal(bundle!.steps.length, 2);
    assert.equal(bundle!.steps[0].nodeId, "t1");
    assert.equal(bundle!.steps[1].nodeId, "t2");
    assert.equal(bundle!.steps[0].kind, "thinking");
    assert.equal(bundle!.steps[1].kind, "tool");
    assert.ok(bundle!.steps.every((x) => x.direct));
  });

  it("includes reverse file links from nodes", () => {
    const s = session(
      [
        node({
          id: "t1",
          type: "message",
          title: "done",
          timestamp: 5,
          links: [{ kind: "file", targetId: "f1", path: "src/a.ts" }],
        }),
      ],
      [file({ id: "f1", path: "src/a.ts", relatedTraceIds: [] })]
    );
    const bundle = getCausalStepsForFile(s, "f1");
    assert.ok(bundle);
    assert.equal(bundle!.steps.length, 1);
    assert.equal(bundle!.steps[0].direct, false);
  });

  it("tracks missing related ids", () => {
    const s = session(
      [],
      [file({ id: "f1", path: "x.ts", relatedTraceIds: ["gone"] })]
    );
    const bundle = getCausalStepsForFile(s, "f1");
    assert.deepEqual(bundle!.missingTraceIds, ["gone"]);
    assert.equal(bundle!.steps.length, 0);
  });

  it("attaches review comments for the path", () => {
    const s = session(
      [node({ id: "t1", type: "thinking", timestamp: 1 })],
      [file({ id: "f1", path: "a.ts", relatedTraceIds: ["t1"] })],
      [
        {
          id: "c1",
          path: "a.ts",
          body: "Looks good",
          author: "user",
          createdAt: 2,
          traceNodeId: "t1",
        },
        {
          id: "c2",
          path: "other.ts",
          body: "skip",
          author: "user",
          createdAt: 3,
        },
      ]
    );
    const bundle = getCausalStepsForFile(s, "f1");
    assert.equal(bundle!.comments.length, 1);
    assert.equal(bundle!.comments[0].body, "Looks good");
  });

  it("resolves files for a trace node", () => {
    const s = session(
      [
        node({
          id: "t1",
          type: "tool_call",
          links: [{ kind: "file", targetId: "f1", path: "a.ts" }],
        }),
      ],
      [
        file({ id: "f1", path: "a.ts", relatedTraceIds: [] }),
        file({ id: "f2", path: "b.ts", relatedTraceIds: ["t1"] }),
      ]
    );
    const files = getFilesForTrace(s, "t1");
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.id === "f1"));
    assert.ok(files.some((f) => f.id === "f2"));
  });

  it("labels causal kinds", () => {
    assert.equal(causalKindLabel("tool"), "Tool");
    assert.equal(causalKindLabel("thinking"), "Thinking");
  });
});
