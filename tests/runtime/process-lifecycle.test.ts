import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultRunTimeoutMs,
  getProcessStatus,
  killProcessTree,
  recordProcessExit,
  registerProcess,
  unregisterProcess,
  stopSessionProcess,
  updateProcessProgress,
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

  it("retains a sanitized terminal outcome for exact-session recovery", () => {
    const child = fakeChild(424243);
    const startedAt = Date.now() - 100;
    const endedAt = Date.now();
    registerProcess(
      {
        sessionId: "sess-terminal-1",
        runId: "run-terminal-1",
        pid: 424243,
        command: "grok",
        args: ["--prompt-file", "redacted"],
        cwd: "C:\\tmp",
        startedAt,
        timeoutMs: 10_000,
      },
      child
    );
    assert.equal(getProcessStatus("sess-terminal-1")?.state, "running");
    recordProcessExit("sess-terminal-1", {
      exitCode: 0,
      signal: null,
      timedOut: false,
      endedAt,
    });
    assert.deepEqual(getProcessStatus("sess-terminal-1"), {
      sessionId: "sess-terminal-1",
      runId: "run-terminal-1",
      state: "exited",
      startedAt,
      endedAt,
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
    assert.equal(
      listProcesses().some((p) => p.sessionId === "sess-terminal-1"),
      false
    );
  });

  it("projects transport progress and the terminal artifact handoff", () => {
    const child = fakeChild(424244);
    const now = Date.now();
    registerProcess(
      {
        sessionId: "sess-progress-1",
        runId: "run-progress-1",
        pid: 424244,
        command: "grok",
        args: [],
        cwd: "C:\\tmp",
        startedAt: now - 100,
        timeoutMs: 10_000,
      },
      child
    );
    const progress = {
      completedShards: 3,
      totalShards: 4,
      verifiedArtifacts: 2,
      requiredArtifacts: 7,
      phase: "specialists" as const,
      checkpointAt: now,
    };
    assert.equal(updateProcessProgress("sess-progress-1", progress, now + 1), true);
    const running = getProcessStatus("sess-progress-1");
    assert.equal(running?.state, "running");
    assert.deepEqual(running?.progress, progress);
    assert.equal(running?.heartbeatAt, now + 1);

    const handoff = {
      state: "validated" as const,
      checkedAt: now + 2,
      manifestPath: "C:\\tmp\\result.json",
      checkpointPath: "C:\\tmp\\checkpoint.json",
      findings: [],
      progress: { ...progress, completedShards: 4, phase: "complete" as const },
    };
    recordProcessExit("sess-progress-1", {
      exitCode: 0,
      signal: null,
      timedOut: false,
      endedAt: now + 3,
      handoff,
    });
    const exited = getProcessStatus("sess-progress-1");
    assert.equal(exited?.state, "exited");
    assert.deepEqual(exited?.handoff, handoff);
  });

  it("does not expose process exit before a required handoff gate finishes", () => {
    const child = {
      pid: 424245,
      killed: false,
      kill: () => true,
      exitCode: 0,
      signalCode: null,
    } as unknown as ChildProcess;
    registerProcess(
      {
        sessionId: "sess-handoff-race-1",
        runId: "run-handoff-race-1",
        pid: 424245,
        command: "grok",
        args: [],
        cwd: "C:\\tmp",
        startedAt: Date.now(),
        timeoutMs: 10_000,
        awaitsTerminalHandoff: true,
      },
      child
    );
    assert.equal(getProcessStatus("sess-handoff-race-1")?.state, "stopping");
    recordProcessExit("sess-handoff-race-1", {
      exitCode: 0,
      signal: null,
      timedOut: false,
    });
    assert.equal(getProcessStatus("sess-handoff-race-1")?.state, "exited");
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
