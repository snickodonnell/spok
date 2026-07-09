import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultRunTimeoutMs,
  killProcessTree,
  registerProcess,
  unregisterProcess,
  stopSessionProcess,
  listProcesses,
  pruneStaleProcesses,
} from "../../src/lib/process-lifecycle";
import type { ChildProcess } from "child_process";

function fakeChild(pid: number): ChildProcess {
  let killed = false;
  return {
    pid,
    get killed() {
      return killed;
    },
    kill() {
      killed = true;
      return true;
    },
    exitCode: null,
  } as unknown as ChildProcess;
}

describe("process lifecycle", () => {
  it("default timeout is positive or zero from env", () => {
    const ms = defaultRunTimeoutMs();
    assert.ok(ms === 0 || ms >= 60_000);
  });

  it("registers and lists processes", () => {
    const child = fakeChild(424242);
    registerProcess(
      {
        sessionId: "sess-test-1",
        pid: 424242,
        command: "grok",
        args: ["-p", "hi"],
        cwd: "C:\\tmp",
        startedAt: Date.now(),
        timeoutMs: 0,
      },
      child
    );
    const listed = listProcesses();
    assert.ok(listed.some((p) => p.sessionId === "sess-test-1"));
    const stop = stopSessionProcess("sess-test-1", { force: true });
    assert.equal(stop.found, true);
    assert.equal(stop.ok, true);
    unregisterProcess("sess-test-1");
    assert.equal(
      listProcesses().some((p) => p.sessionId === "sess-test-1"),
      false
    );
  });

  it("stop missing session is ok", () => {
    const r = stopSessionProcess("no-such-session");
    assert.equal(r.found, false);
    assert.equal(r.ok, true);
  });

  it("killProcessTree marks already-dead as ok", () => {
    const child = fakeChild(0);
    const r = killProcessTree(child);
    assert.equal(r.ok, true);
  });

  it("pruneStaleProcesses removes exited entries", () => {
    const child = {
      pid: 99,
      killed: false,
      kill: () => true,
      exitCode: 0,
    } as unknown as ChildProcess;
    registerProcess(
      {
        sessionId: "stale-1",
        pid: 99,
        command: "x",
        args: [],
        cwd: "/",
        startedAt: Date.now(),
        timeoutMs: 0,
      },
      child
    );
    const n = pruneStaleProcesses();
    assert.ok(n >= 1);
    assert.equal(
      listProcesses().some((p) => p.sessionId === "stale-1"),
      false
    );
  });
});
