import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

type ReadyMessage = {
  type: "spok-runtime-ready";
  host: string;
  port: number;
  pid: number;
};

function waitForReady(child: ChildProcess): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("runtime readiness timed out")), 10_000);
    child.once("exit", (code) => reject(new Error(`runtime exited early: ${code}`)));
    child.on("message", (message) => {
      const ready = message as ReadyMessage;
      if (ready?.type !== "spok-runtime-ready") return;
      clearTimeout(timer);
      resolve(ready);
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", resolve));
}

describe("standalone runtime process", () => {
  it("holds an OS-assigned loopback port, serves health, and accepts supervisor shutdown", async () => {
    const token = "runtime-main-test-capability-token";
    const child = fork(path.resolve("src/server/main.ts"), [], {
      cwd: process.cwd(),
      env: { ...process.env, SPOK_PORT: "0", SPOK_LOCAL_TOKEN: token },
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });

    try {
      const ready = await waitForReady(child);
      assert.equal(ready.host, "127.0.0.1");
      assert.ok(ready.port > 0);

      const response = await fetch(`http://${ready.host}:${ready.port}/api/health`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok?: boolean; localToken?: string; pid?: number };
      assert.equal(body.ok, true);
      assert.equal(body.localToken, token);
      assert.equal(body.pid, ready.pid);

      const exited = waitForExit(child);
      child.send({ type: "spok-runtime-shutdown" });
      assert.equal(await exited, 0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
});
