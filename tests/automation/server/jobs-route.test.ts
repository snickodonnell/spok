import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dispatchRequest } from "../../../src/server/router";
import { getLocalCapabilityToken } from "../../../src/lib/security/local-api";
import { CAPABILITY_HEADER } from "../../../src/lib/security/local-api-shared";
import {
  clearTrustedRoots,
  reloadTrustedRootsFromDisk,
  trustWorkspaceRoot,
} from "../../../src/lib/security/workspace-trust";

let root = "";
let workspace = "";
let previousSpokHome: string | undefined;

beforeEach(() => {
  previousSpokHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-job-route-"));
  workspace = path.join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  process.env.SPOK_HOME = path.join(root, "home");
  clearTrustedRoots();
  trustWorkspaceRoot(workspace);
});

afterEach(() => {
  if (previousSpokHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousSpokHome;
  reloadTrustedRootsFromDisk();
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function request(method: string, body?: unknown, origin?: string): Request {
  const headers = new Headers({ host: "127.0.0.1:7788" });
  headers.set(CAPABILITY_HEADER, getLocalCapabilityToken());
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin) headers.set("origin", origin);
  return new Request("http://127.0.0.1:7788/api/automation/jobs", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("automation jobs shared route", { concurrency: false }, () => {
  it("requires capability auth and rejects invalid origins", async () => {
    const missing = await dispatchRequest(
      new Request("http://127.0.0.1:7788/api/automation/jobs", {
        headers: { host: "127.0.0.1:7788" },
      })
    );
    assert.equal(missing.status, 401);

    const invalidOrigin = await dispatchRequest(
      request("GET", undefined, "https://evil.example")
    );
    assert.equal(invalidOrigin.status, 403);
  });

  it("persists and loads a trusted queued job through standalone dispatch", async () => {
    const job = {
      id: "job-route",
      kind: "background",
      title: "Route job",
      prompt: "Run focused tests",
      cwd: workspace,
      isolate: true,
      status: "queued",
      priority: 0,
      createdAt: 100,
    };
    const saved = await dispatchRequest(request("POST", { job }));
    assert.equal(saved.status, 200);
    const savedBody = (await saved.json()) as { job?: { id?: string } };
    assert.equal(savedBody.job?.id, "job-route");

    const loaded = await dispatchRequest(request("GET"));
    assert.equal(loaded.status, 200);
    const body = (await loaded.json()) as {
      version?: number;
      jobs?: Array<{ id: string; status: string }>;
    };
    assert.equal(body.version, 1);
    assert.equal(body.jobs?.[0]?.id, "job-route");
    assert.equal(body.jobs?.[0]?.status, "queued");
  });
});
