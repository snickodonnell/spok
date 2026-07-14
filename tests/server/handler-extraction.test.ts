import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleHealthGet } from "../../src/server/routes/health";
import { handleCliStatusGet } from "../../src/server/routes/cli-status";
import { dispatchRequest } from "../../src/server/router";
import { CAPABILITY_HEADER } from "../../src/lib/security/local-api-shared";

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
});
