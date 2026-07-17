import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleHealthGet } from "../../src/server/routes/health";
import { handleCliStatusGet } from "../../src/server/routes/cli-status";
import {
  handleSessionStartGet,
  handleSessionStartPost,
  startSessionStreamHeartbeat,
} from "../../src/server/routes/session-start";
import { dispatchRequest } from "../../src/server/router";
import { CAPABILITY_HEADER } from "../../src/lib/security/local-api-shared";
import {
  registerProcess,
  unregisterProcess,
} from "../../src/lib/process-lifecycle";
import type { ChildProcess } from "child_process";

describe("server handler extraction", () => {
  it("health denies non-local hosts without token leakage", async () => {
    const res = await handleHealthGet(
      new Request("http://evil.example/api/health", {
        headers: { host: "evil.example" },
      })
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { localToken?: string; error?: string };
    assert.equal(body.localToken, undefined);
    assert.ok(body.error);
  });

  it("health issues token for loopback Host", async () => {
    const res = await handleHealthGet(
      new Request("http://127.0.0.1:3000/api/health", {
        headers: {
          host: "127.0.0.1:3000",
          // no Origin — native / tooling residual allowed for local host
        },
      })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      localToken?: string;
      runtime?: string;
      pid?: number;
    };
    assert.equal(body.ok, true);
    assert.ok(body.localToken && body.localToken.length > 8);
    assert.equal(body.runtime, "node");
    assert.ok(typeof body.pid === "number");
  });

  it("dispatch routes health and 404s unknown paths", async () => {
    const ok = await dispatchRequest(
      new Request("http://127.0.0.1:7788/api/health", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    assert.equal(ok.status, 200);

    const missing = await dispatchRequest(
      new Request("http://127.0.0.1:7788/api/nope", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    assert.equal(missing.status, 404);
  });

  it("privileged sessions list requires capability token", async () => {
    const res = await dispatchRequest(
      new Request("http://127.0.0.1:7788/api/sessions", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    assert.ok(res.status === 401 || res.status === 403);

    const health = await handleHealthGet(
      new Request("http://127.0.0.1:7788/api/health", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    const { localToken } = (await health.json()) as { localToken: string };
    const authed = await dispatchRequest(
      new Request("http://127.0.0.1:7788/api/sessions", {
        headers: {
          host: "127.0.0.1:7788",
          [CAPABILITY_HEADER]: localToken,
        },
      })
    );
    assert.equal(authed.status, 200);
    const body = (await authed.json()) as { sessions?: unknown[] };
    assert.ok(Array.isArray(body.sessions));
  });

  it("keeps detailed Grok discovery behind auth and a fixed capability vocabulary", async () => {
    const denied = await handleCliStatusGet(
      new Request("http://127.0.0.1:7788/api/runtime/cli-status?capabilities=1", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    assert.ok(denied.status === 401 || denied.status === 403);

    const health = await handleHealthGet(
      new Request("http://127.0.0.1:7788/api/health", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    const { localToken } = (await health.json()) as { localToken: string };
    const invalid = await handleCliStatusGet(
      new Request(
        "http://127.0.0.1:7788/api/runtime/cli-status?required=not_a_capability",
        {
          headers: {
            host: "127.0.0.1:7788",
            [CAPABILITY_HEADER]: localToken,
          },
        }
      )
    );
    assert.equal(invalid.status, 400);
    const invalidBody = (await invalid.json()) as { code?: string };
    assert.equal(invalidBody.code, "invalid_capability_requirement");

    const arbitraryCommand = await handleCliStatusGet(
      new Request(
        "http://127.0.0.1:7788/api/runtime/cli-status?capabilities=1&command=spok-not-configured-cli",
        {
          headers: {
            host: "127.0.0.1:7788",
            [CAPABILITY_HEADER]: localToken,
          },
        }
      )
    );
    assert.equal(arbitraryCommand.status, 403);
    const commandBody = (await arbitraryCommand.json()) as { code?: string };
    assert.equal(commandBody.code, "command_not_allowed");
  });

  it("rejects invalid or ambiguous GrokRunSpec requests before launch", async () => {
    const health = await handleHealthGet(
      new Request("http://127.0.0.1:7788/api/health", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    const { localToken } = (await health.json()) as { localToken: string };
    const headers = {
      host: "127.0.0.1:7788",
      "content-type": "application/json",
      [CAPABILITY_HEADER]: localToken,
    };

    const invalid = await handleSessionStartPost(
      new Request("http://127.0.0.1:7788/api/session/start", {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: "host-1", runSpec: {} }),
      })
    );
    assert.equal(invalid.status, 400);
    const invalidBody = (await invalid.json()) as { code?: string; policy?: string };
    assert.equal(invalidBody.code, "invalid_run_spec");
    assert.equal(invalidBody.policy, "provider_contract");

    const ambiguous = await handleSessionStartPost(
      new Request("http://127.0.0.1:7788/api/session/start", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId: "host-2",
          runSpec: {},
          command: "grok",
          args: [],
        }),
      })
    );
    assert.equal(ambiguous.status, 400);
    const ambiguousBody = (await ambiguous.json()) as { code?: string };
    assert.equal(ambiguousBody.code, "invalid_run_spec");
  });

  it("heartbeats silent long-running streams without materializing provider output", async () => {
    const envelope = await new Promise<Record<string, unknown>>((resolve) => {
      const stop = startSessionStreamHeartbeat(
        (value) => {
          stop();
          resolve(value as Record<string, unknown>);
        },
        { sessionId: "heartbeat-session", runId: "heartbeat-run" },
        5
      );
    });
    assert.equal(envelope.type, "heartbeat");
    assert.equal(envelope.sessionId, "heartbeat-session");
    assert.equal(envelope.runId, "heartbeat-run");
    assert.equal(typeof envelope.timestamp, "number");
  });

  it("reports exact run status and rejects a duplicate active-session launch", async () => {
    const health = await handleHealthGet(
      new Request("http://127.0.0.1:7788/api/health", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    const { localToken } = (await health.json()) as { localToken: string };
    const child = {
      pid: 919191,
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: () => true,
    } as unknown as ChildProcess;
    registerProcess(
      {
        sessionId: "duplicate-session",
        runId: "original-run",
        pid: 919191,
        command: "grok",
        args: [],
        cwd: "C:\\tmp",
        startedAt: 123,
        timeoutMs: 10_000,
      },
      child
    );
    try {
      const headers = {
        host: "127.0.0.1:7788",
        "content-type": "application/json",
        [CAPABILITY_HEADER]: localToken,
      };
      const status = await handleSessionStartGet(
        new Request(
          "http://127.0.0.1:7788/api/session/start?sessionId=duplicate-session",
          { headers }
        )
      );
      assert.equal(status.status, 200);
      const statusBody = (await status.json()) as {
        state?: string;
        runId?: string;
      };
      assert.equal(statusBody.state, "running");
      assert.equal(statusBody.runId, "original-run");

      const duplicate = await handleSessionStartPost(
        new Request("http://127.0.0.1:7788/api/session/start", {
          method: "POST",
          headers,
          body: JSON.stringify({
            sessionId: "duplicate-session",
            runSpec: {},
          }),
        })
      );
      assert.equal(duplicate.status, 409);
      const duplicateBody = (await duplicate.json()) as { code?: string };
      assert.equal(duplicateBody.code, "session_already_running");
    } finally {
      unregisterProcess("duplicate-session");
    }
  });
});
