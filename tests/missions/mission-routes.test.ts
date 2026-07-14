import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dispatchRequest } from "../../src/server/router";
import { getLocalCapabilityToken } from "../../src/lib/security/local-api";
import { CAPABILITY_HEADER } from "../../src/lib/security/local-api-shared";
import {
  clearTrustedRoots,
  trustWorkspaceRoot,
} from "../../src/lib/security/workspace-trust";

let root = "";
let workspace = "";
let previousSpokHome: string | undefined;

beforeEach(() => {
  previousSpokHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-mission-route-"));
  workspace = path.join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  process.env.SPOK_HOME = path.join(root, "home");
  clearTrustedRoots();
});

afterEach(() => {
  clearTrustedRoots();
  if (previousSpokHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousSpokHome;
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function request(
  method: string,
  urlPath: string,
  body?: unknown,
  origin?: string,
  token?: string | null
): Request {
  const headers = new Headers({ host: "127.0.0.1:7788" });
  if (token !== null) {
    headers.set(CAPABILITY_HEADER, token ?? getLocalCapabilityToken());
  }
  if (body !== undefined) headers.set("content-type", "application/json");
  if (origin) headers.set("origin", origin);
  return new Request(`http://127.0.0.1:7788${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("mission routes", { concurrency: false }, () => {
  it("requires capability auth and rejects invalid origins", async () => {
    const missing = await dispatchRequest(
      request("GET", "/api/missions", undefined, undefined, null)
    );
    assert.equal(missing.status, 401);

    const invalidOrigin = await dispatchRequest(
      request("GET", "/api/missions", undefined, "https://evil.example")
    );
    assert.equal(invalidOrigin.status, 403);
  });

  it("creates, lists, reads, checkpoints through standalone dispatch", async () => {
    const createBody = {
      mission: {
        id: "msn_route_1",
        outcome: "Route-level mission CRUD",
        definitionOfDone: ["GET list works"],
        policyRef: "policy.manual.v1",
        repository: workspace,
        budgets: { retries: 1, tokens: 10_000 },
        authority: {
          policyRef: "policy.manual.v1",
          capabilities: ["read_repo", "edit_src"],
          repository: workspace,
        },
        milestones: [
          {
            id: "ms_r1",
            title: "API",
            exitCriteria: ["routes green"],
            workItemIds: ["wi_r1"],
          },
        ],
        workItems: [
          {
            id: "wi_r1",
            milestoneId: "ms_r1",
            title: "Handlers",
            owner: "spok",
            requestedCapability: "edit_src",
            expectedEvidence: ["tests/missions/mission-routes.test.ts"],
            budgets: { tokens: 5_000 },
            retries: { max: 1, used: 0 },
          },
        ],
      },
    };

    const created = await dispatchRequest(
      request("POST", "/api/missions", createBody)
    );
    assert.equal(created.status, 200);
    const createdJson = (await created.json()) as {
      ok?: boolean;
      mission?: { id?: string };
      authorityNeutral?: boolean;
    };
    assert.equal(createdJson.ok, true);
    assert.equal(createdJson.mission?.id, "msn_route_1");
    assert.equal(createdJson.authorityNeutral, true);

    const listed = await dispatchRequest(request("GET", "/api/missions"));
    assert.equal(listed.status, 200);
    const listJson = (await listed.json()) as {
      version?: number;
      missions?: Array<{ id: string }>;
      authorityNeutral?: boolean;
    };
    assert.equal(listJson.version, 1);
    assert.equal(listJson.authorityNeutral, true);
    assert.ok(listJson.missions?.some((m) => m.id === "msn_route_1"));

    const got = await dispatchRequest(
      request("GET", "/api/missions/msn_route_1")
    );
    assert.equal(got.status, 200);
    const gotJson = (await got.json()) as {
      mission?: { workItems?: unknown[]; authority?: { authorityNeutralRestore?: boolean } };
      authorityNeutral?: boolean;
    };
    assert.equal(gotJson.authorityNeutral, true);
    assert.equal(gotJson.mission?.workItems?.length, 1);
    assert.equal(gotJson.mission?.authority?.authorityNeutralRestore, true);

    const ckpt = await dispatchRequest(
      request("POST", "/api/missions/msn_route_1/checkpoint", {
        changedAssumptions: ["Routes are plan persistence only"],
      })
    );
    assert.equal(ckpt.status, 200);
    const ckptJson = (await ckpt.json()) as {
      ok?: boolean;
      checkpoint?: { id?: string; changedAssumptions?: string[] };
      authorityNeutral?: boolean;
    };
    assert.equal(ckptJson.ok, true);
    assert.equal(ckptJson.authorityNeutral, true);
    assert.ok(ckptJson.checkpoint?.id);
    assert.equal(
      ckptJson.checkpoint?.changedAssumptions?.[0],
      "Routes are plan persistence only"
    );

    const ckptGet = await dispatchRequest(
      request("GET", "/api/missions/msn_route_1/checkpoint")
    );
    assert.equal(ckptGet.status, 200);
    const ckptGetJson = (await ckptGet.json()) as {
      checkpoint?: { id?: string };
    };
    assert.equal(ckptGetJson.checkpoint?.id, ckptJson.checkpoint?.id);
  });

  it("denies invalid dependency completion and authority over-request via PUT", async () => {
    const created = await dispatchRequest(
      request("POST", "/api/missions", {
        mission: {
          id: "msn_route_deny",
          outcome: "Denial paths",
          policyRef: "policy.manual.v1",
          repository: workspace,
          authority: {
            policyRef: "policy.manual.v1",
            capabilities: ["read_repo"],
            repository: workspace,
          },
          workItems: [
            {
              id: "wi_d1",
              title: "A",
              owner: "spok",
              requestedCapability: "read_repo",
            },
          ],
        },
      })
    );
    assert.equal(created.status, 200);

    // Authority over-request
    const over = await dispatchRequest(
      request("PUT", "/api/missions/msn_route_deny", {
        mission: {
          id: "msn_route_deny",
          outcome: "Denial paths",
          policyRef: "policy.manual.v1",
          repository: workspace,
          status: "active",
          authority: {
            policyRef: "policy.manual.v1",
            capabilities: ["read_repo"],
            repository: workspace,
            grantedAt: 1,
            authorityNeutralRestore: true,
          },
          workItems: [
            {
              id: "wi_d1",
              title: "A",
              owner: "spok",
              requestedCapability: "shell_unrestricted",
              status: "pending",
            },
          ],
          milestones: [],
          dependencies: [],
          budgets: {},
          definitionOfDone: [],
          constraints: [],
          statusProvenance: { at: 1, source: "user", reason: "update" },
          nextAction: { kind: "fix", label: "Fix authority" },
          createdAt: 1,
          updatedAt: 1,
          version: 1,
        },
      })
    );
    assert.equal(over.status, 400);
    const overJson = (await over.json()) as { code?: string };
    assert.equal(overJson.code, "authority_over_request");

    // Satisfied dependency without evidence
    const dep = await dispatchRequest(
      request("PUT", "/api/missions/msn_route_deny", {
        mission: {
          id: "msn_route_deny",
          outcome: "Denial paths",
          policyRef: "policy.manual.v1",
          repository: workspace,
          status: "active",
          authority: {
            policyRef: "policy.manual.v1",
            capabilities: ["read_repo"],
            repository: workspace,
            grantedAt: 1,
            authorityNeutralRestore: true,
          },
          workItems: [
            {
              id: "wi_d1",
              title: "A",
              owner: "spok",
              requestedCapability: "read_repo",
              status: "active",
            },
            {
              id: "wi_d2",
              title: "B",
              owner: "spok",
              requestedCapability: "read_repo",
              status: "pending",
              dependencies: ["wi_d1"],
            },
          ],
          milestones: [],
          dependencies: [
            {
              id: "dep_bad",
              from: "wi_d1",
              to: "wi_d2",
              requiresEvidence: true,
              evidenceRefs: [],
              satisfied: true,
            },
          ],
          budgets: {},
          definitionOfDone: [],
          constraints: [],
          statusProvenance: { at: 1, source: "user", reason: "update" },
          nextAction: { kind: "fix", label: "Fix dep" },
          createdAt: 1,
          updatedAt: 1,
          version: 1,
        },
      })
    );
    assert.equal(dep.status, 400);
    const depJson = (await dep.json()) as { code?: string };
    assert.equal(depJson.code, "missing_evidence");
  });

  it("compiles durable receipts and schedules only verified ready work", async () => {
    const worktree = path.join(workspace, "worktrees", "route-agent");
    mkdirSync(worktree, { recursive: true });
    trustWorkspaceRoot(workspace);

    const created = await dispatchRequest(
      request("POST", "/api/missions", {
        mission: {
          id: "msn_route_orchestration",
          outcome: "Compile and schedule a bounded route work item",
          definitionOfDone: ["The route check passes"],
          policyRef: "policy.manual.v1",
          repository: workspace,
          worktreePath: worktree,
          budgets: { tokens: 5_000, retries: 1 },
          authority: {
            policyRef: "policy.manual.v1",
            capabilities: ["read_repo", "edit_src", "run_tests"],
            repository: workspace,
            worktreePath: worktree,
          },
          workItems: [
            {
              id: "wi_route_orchestration",
              title: "Implement the bounded route",
              owner: "route-agent",
              requestedCapability: "edit_src",
              authorityReceipt: {
                policyRef: "policy.manual.v1",
                capabilities: ["read_repo", "edit_src", "run_tests"],
                repository: workspace,
                worktreePath: worktree,
              },
              budgets: { tokens: 3_000, retries: 1 },
              expectedEvidence: ["test:mission-routes"],
            },
          ],
        },
      })
    );
    assert.equal(created.status, 200);

    const compiled = await dispatchRequest(
      request("POST", "/api/missions/msn_route_orchestration/receipts", {
        id: "receipt_route_1",
        repositoryBase: "abc123",
        integrationOwner: "spok",
        validation: ["npm test -- mission-routes"],
        nextCheckpoint: "After the specialist report is reconciled",
        budget: {
          totalTokens: 5_000,
          integrationReserveTokens: 1_000,
          recoveryReserveTokens: 500,
        },
        workItems: [
          {
            workItemId: "wi_route_orchestration",
            integrationOwner: "spok",
            priority: 10,
            scope: { own: ["src/server/routes"], exclude: ["src/components"] },
            execution: {
              cwd: worktree,
              baseRevision: "abc123",
              isolation: "verified",
              session: {
                intent: "new",
                sessionId: "33333333-3333-4333-8333-333333333333",
              },
              allowSubagents: false,
            },
            authority: {
              permission: "default",
              tools: ["read_repo", "edit_src", "run_tests"],
              destructive: false,
            },
            budget: { maxTurns: 6, tokens: 3_000, retry: 1 },
            context: ["src/server/routes/mission-orchestration.ts"],
            definitionOfDone: ["Route tests pass"],
            checks: ["npm test -- mission-routes"],
            returnWhen: "complete",
          },
        ],
      })
    );
    assert.equal(compiled.status, 201);
    const compiledJson = (await compiled.json()) as {
      bundle?: { mission?: { id?: string }; workItems?: Array<{ reportSchema?: string }> };
    };
    assert.equal(compiledJson.bundle?.mission?.id, "receipt_route_1");
    assert.equal(compiledJson.bundle?.workItems?.[0]?.reportSchema, "specialist-v1");

    const scheduled = await dispatchRequest(
      request("POST", "/api/missions/msn_route_orchestration/schedule", {
        receiptId: "receipt_route_1",
        schedule: {
          providerCapacity: 1,
          activeLanes: [
            {
              workItemId: "requested-placeholder",
              providerEmitted: false,
              reservedTokens: 0,
            },
          ],
          verifiedIsolation: { wi_route_orchestration: true },
        },
      })
    );
    assert.equal(scheduled.status, 200);
    const scheduledJson = (await scheduled.json()) as {
      schedule?: {
        selected?: string[];
        capacity?: { requestedLanes?: number; realActiveLanes?: number };
        budget?: { integrationReserveTokens?: number; recoveryReserveTokens?: number };
      };
    };
    assert.deepEqual(scheduledJson.schedule?.selected, ["wi_route_orchestration"]);
    assert.equal(scheduledJson.schedule?.capacity?.requestedLanes, 1);
    assert.equal(scheduledJson.schedule?.capacity?.realActiveLanes, 0);
    assert.equal(scheduledJson.schedule?.budget?.integrationReserveTokens, 1_000);
    assert.equal(scheduledJson.schedule?.budget?.recoveryReserveTokens, 500);
  });
});
