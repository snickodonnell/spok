import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
  type LocalPolicyDenial,
} from "../../src/lib/security/local-api";

describe("policyDenialResponse (Web Response)", () => {
  it("returns a standard Response, not a Next-specific type", async () => {
    const body: LocalPolicyDenial = {
      error: "Missing local capability token",
      code: "missing_token",
      policy: "local_capability",
      action: "unit_test",
    };
    const res = policyDenialResponse(401, body);

    assert.ok(res instanceof Response);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(
      res.headers.get("content-type") ?? "",
      /application\/json/
    );

    const json = (await res.json()) as LocalPolicyDenial;
    assert.equal(json.code, "missing_token");
    assert.equal(json.policy, "local_capability");
    assert.equal(json.action, "unit_test");
    assert.equal(json.error, body.error);
  });

  it("denyFromAuthorize mirrors authorize failure status and body", async () => {
    const req = new Request("http://localhost:3000/api/session/start", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    });
    const auth = authorizePrivilegedRequest(req, "session_start");
    assert.equal(auth.ok, false);
    if (auth.ok) return;

    const res = denyFromAuthorize(auth);
    assert.ok(res instanceof Response);
    assert.equal(res.status, auth.status);

    const json = (await res.json()) as LocalPolicyDenial;
    assert.equal(json.code, auth.body.code);
    assert.equal(json.action, "session_start");
  });

  it("denyFromAuthorize rejects invalid host with 403", async () => {
    const req = new Request("http://evil.example/api/health", {
      method: "GET",
      headers: {
        host: "evil.example",
        origin: "https://evil.example",
      },
    });
    const auth = authorizePrivilegedRequest(req, "unit_host");
    assert.equal(auth.ok, false);
    if (auth.ok) return;

    const res = denyFromAuthorize(auth);
    assert.equal(res.status, 403);
    const json = (await res.json()) as LocalPolicyDenial;
    assert.equal(json.code, "invalid_host");
  });
});
