import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSyncedStatus } from "../../src/lib/host-session-sync";

describe("host session sync status", () => {
  it("process registry wins for running", () => {
    assert.equal(
      resolveSyncedStatus({
        sessionId: "a",
        liveIds: new Set(["a"]),
        metaStatus: "completed",
        localStatus: "ready",
      }),
      "running"
    );
  });

  it("clears stale running when process is gone", () => {
    assert.equal(
      resolveSyncedStatus({
        sessionId: "a",
        liveIds: new Set(),
        metaStatus: "running",
        localStatus: "running",
      }),
      "ready"
    );
  });

  it("keeps local completed/error after process ends", () => {
    assert.equal(
      resolveSyncedStatus({
        sessionId: "a",
        liveIds: new Set(),
        metaStatus: "running",
        localStatus: "completed",
      }),
      "completed"
    );
    assert.equal(
      resolveSyncedStatus({
        sessionId: "a",
        liveIds: new Set(),
        metaStatus: "ready",
        localStatus: "error",
      }),
      "error"
    );
  });

  it("uses meta when not live and not terminal local", () => {
    assert.equal(
      resolveSyncedStatus({
        sessionId: "a",
        liveIds: new Set(),
        metaStatus: "completed",
        localStatus: "ready",
      }),
      "completed"
    );
  });
});
