import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  cancelUserApproval,
  getApprovalQueue,
  requestUserApproval,
  subscribeApprovalQueue,
} from "../../src/lib/settings-client";
import type { ApprovalRequest } from "../../src/lib/settings/types";

function approval(id: string, sessionId: string): ApprovalRequest {
  return {
    id,
    sessionId,
    timestamp: Date.now(),
    action: "spawn",
    cwd: `C:\\repo\\${sessionId}`,
    command: "grok",
    args: ["-p", "task"],
    profile: "grok",
    risk: "medium",
    reason: `Approve ${sessionId}`,
    policy: "manual",
    preview: `grok -p task (${sessionId})`,
  };
}

afterEach(() => {
  for (const request of getApprovalQueue()) {
    cancelUserApproval(request.id);
  }
});

describe("client approval queue", () => {
  it("keeps concurrent session approvals independent and FIFO", async () => {
    const snapshots: string[][] = [];
    const unsubscribe = subscribeApprovalQueue((snapshot) => {
      snapshots.push(snapshot.requests.map((request) => request.id));
    });

    const first = requestUserApproval(approval("approval-a", "session-a"));
    const second = requestUserApproval(approval("approval-b", "session-b"));

    assert.deepEqual(
      getApprovalQueue().map((request) => request.id),
      ["approval-a", "approval-b"]
    );

    // Resolve the second request explicitly; the first remains blocked.
    cancelUserApproval("approval-b");
    assert.deepEqual(await second, { decision: "deny" });
    assert.deepEqual(
      getApprovalQueue().map((request) => request.id),
      ["approval-a"]
    );

    cancelUserApproval("approval-a");
    assert.deepEqual(await first, { decision: "deny" });
    assert.deepEqual(getApprovalQueue(), []);
    assert.ok(
      snapshots.some(
        (ids) => ids.length === 2 && ids[0] === "approval-a" && ids[1] === "approval-b"
      )
    );
    unsubscribe();
  });

  it("rejects duplicate request ids without replacing the original waiter", async () => {
    const original = requestUserApproval(approval("approval-dup", "session-a"));
    await assert.rejects(
      requestUserApproval(approval("approval-dup", "session-b")),
      /already waiting/i
    );

    assert.equal(getApprovalQueue().length, 1);
    assert.equal(getApprovalQueue()[0].sessionId, "session-a");
    cancelUserApproval("approval-dup");
    assert.deepEqual(await original, { decision: "deny" });
  });

  it("removes and rejects only the approval bound to an aborted run", async () => {
    const firstAbort = new AbortController();
    const first = requestUserApproval(
      approval("approval-abort", "session-a"),
      firstAbort.signal
    );
    const second = requestUserApproval(approval("approval-stays", "session-b"));

    firstAbort.abort();
    await assert.rejects(first, (error: unknown) => {
      return error instanceof DOMException && error.name === "AbortError";
    });
    assert.deepEqual(
      getApprovalQueue().map((request) => request.id),
      ["approval-stays"]
    );

    cancelUserApproval("approval-stays");
    assert.deepEqual(await second, { decision: "deny" });
  });
});
