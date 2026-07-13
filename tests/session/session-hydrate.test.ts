import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metaShellSession } from "../../src/lib/session-hydrate";
import type { SessionMetaRecord } from "../../src/lib/types";

describe("session hydrate helpers", () => {
  it("builds a partial meta shell without nodes", () => {
    const meta: SessionMetaRecord = {
      id: "abc123session",
      name: "Demo",
      status: "running",
      createdAt: 1,
      updatedAt: 2,
      source: "live",
      cwd: "C:\\dev\\spok",
      command: "grok",
      eventCount: 9000,
      rawCount: 100,
      formatVersion: 1,
    };
    const shell = metaShellSession(meta);
    assert.equal(shell.hydratePartial, true);
    assert.equal(shell.restoreState, "restoring");
    assert.equal(shell.status, "ready"); // never restore as running without process
    assert.equal(shell.eventCount, 9000);
    assert.equal(Object.keys(shell.nodes).length, 0);
    assert.equal(shell.config.cwd, "C:\\dev\\spok");
  });
});
