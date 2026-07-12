import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  getAutomationJobsFilePath,
  loadAutomationJobLedger,
  replaceAutomationJobs,
  upsertAutomationJob,
} from "../../../src/lib/automation/jobs-fs";
import {
  clearTrustedRoots,
  reloadTrustedRootsFromDisk,
  trustWorkspaceRoot,
} from "../../../src/lib/security/workspace-trust";
import type { AutomationJob } from "../../../src/lib/automation/types";

let root = "";
let workspace = "";
let previousSpokHome: string | undefined;

function job(
  id: string,
  status: AutomationJob["status"] = "queued",
  cwd = workspace
): AutomationJob {
  return {
    id,
    kind: "background",
    title: `Job ${id}`,
    prompt: "Refactor the parser and run focused tests",
    cwd,
    isolate: true,
    status,
    priority: 0,
    createdAt: 100,
    updatedAt: 100,
    policy: { requireTrusted: true, isolate: true },
  };
}

beforeEach(() => {
  previousSpokHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-jobs-"));
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

describe("durable automation job ledger", { concurrency: false }, () => {
  it("roundtrips, overwrites atomically, redacts terminal secrets, and leaves no temp files", () => {
    const first = replaceAutomationJobs([job("job-first")]);
    assert.equal(first.ok, true);
    assert.equal(loadAutomationJobLedger().jobs[0]?.status, "queued");

    const terminal: AutomationJob = {
      ...job("job-first", "completed"),
      prompt: "Finished with token=supersecret12345",
      summary: "Bearer abcdefghijklmnopqrstuvwxyz",
      finishedAt: 200,
      outcome: {
        kind: "completed",
        at: 200,
        summary: "token=anothersecret12345",
      },
    };
    const second = replaceAutomationJobs([
      { ...terminal, env: { API_TOKEN: "never-write-this-secret" } },
    ]);
    assert.equal(second.ok, true);

    const raw = readFileSync(getAutomationJobsFilePath(), "utf8");
    assert.match(raw, /"version": 1/);
    assert.doesNotMatch(
      raw,
      /supersecret|abcdefghijklmnop|anothersecret|never-write-this-secret/i
    );
    assert.match(raw, /\[REDACTED\]/);
    assert.deepEqual(
      readdirSync(path.dirname(getAutomationJobsFilePath())).filter((name) =>
        name.endsWith(".tmp")
      ),
      []
    );
    const loaded = loadAutomationJobLedger();
    assert.equal(loaded.jobs[0]?.status, "completed");
    assert.equal(loaded.jobs[0]?.outcome?.kind, "completed");
  });

  it("rejects active secret prompts and untrusted queued jobs", () => {
    const sensitive = upsertAutomationJob({
      ...job("job-secret"),
      prompt: "Deploy with password=supersecret12345",
    });
    assert.equal(sensitive.ok, false);
    if (!sensitive.ok) assert.equal(sensitive.code, "sensitive_prompt");

    const outside = path.join(root, "outside");
    mkdirSync(outside);
    const untrusted = upsertAutomationJob(job("job-untrusted", "queued", outside));
    assert.equal(untrusted.ok, false);
    if (!untrusted.ok) assert.equal(untrusted.code, "untrusted_cwd");
  });

  it("recovers trusted queued jobs, interrupts stale runs, and blocks unsafe records", () => {
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    const ledger = {
      version: 1,
      updatedAt: 100,
      jobs: [
        job("job-queued"),
        { ...job("job-running", "running"), sessionId: "session-running" },
        job("job-revoked", "queued", outside),
        { ...job("job-malformed"), cwd: "relative/path" },
        { ...job("job-sensitive"), prompt: "token=supersecret12345" },
      ],
    };
    writeFileSync(getAutomationJobsFilePath(), JSON.stringify(ledger), "utf8");

    const loaded = loadAutomationJobLedger({ reconcile: true, now: 500 });
    assert.equal(loaded.corrupt, false);
    assert.equal(loaded.discarded, 2);
    assert.equal(loaded.reconciled, 2);
    assert.equal(
      loaded.jobs.find((item) => item.id === "job-queued")?.status,
      "queued"
    );
    const interrupted = loaded.jobs.find((item) => item.id === "job-running");
    assert.equal(interrupted?.status, "failed");
    assert.equal(interrupted?.outcome?.kind, "interrupted");
    assert.equal(interrupted?.finishedAt, 500);
    assert.equal(
      loaded.jobs.find((item) => item.id === "job-revoked")?.status,
      "failed"
    );
  });

  it("returns an empty safe result for corrupt and unsupported ledgers", () => {
    mkdirSync(path.dirname(getAutomationJobsFilePath()), { recursive: true });
    writeFileSync(getAutomationJobsFilePath(), "{not-json", "utf8");
    assert.deepEqual(loadAutomationJobLedger(), {
      jobs: [],
      reconciled: 0,
      discarded: 0,
      corrupt: true,
    });

    writeFileSync(
      getAutomationJobsFilePath(),
      JSON.stringify({ version: 99, jobs: [job("job-future")] }),
      "utf8"
    );
    assert.equal(loadAutomationJobLedger().corrupt, true);
    assert.equal(loadAutomationJobLedger().jobs.length, 0);
  });

  it("caps terminal history", () => {
    const history = Array.from({ length: 120 }, (_, index) => ({
      ...job(`job-history-${index}`, "completed"),
      finishedAt: 1_000 + index,
    }));
    const saved = replaceAutomationJobs(history);
    assert.equal(saved.ok, true);
    if (saved.ok) assert.equal(saved.jobs.length, 100);
    assert.equal(loadAutomationJobLedger().jobs.length, 100);
  });

  it("roundtrips sanitized Enterprise linkage and rejects malformed roles", () => {
    const linked = {
      ...job("job-enterprise"),
      enterprise: {
        version: 1 as const,
        teamId: "ent-123",
        role: "leader" as const,
        phase: "mission" as const,
        turn: 1,
        memberId: "spok",
        memberName: "Spok",
        acceptedAt: 250,
      },
    };
    const saved = upsertAutomationJob(linked);
    assert.equal(saved.ok, true);
    assert.equal(
      loadAutomationJobLedger().jobs[0]?.enterprise?.teamId,
      "ent-123"
    );
    assert.equal(loadAutomationJobLedger().jobs[0]?.enterprise?.turn, 1);
    assert.equal(loadAutomationJobLedger().jobs[0]?.enterprise?.acceptedAt, 250);

    const malformed = upsertAutomationJob({
      ...linked,
      id: "job-enterprise-bad",
      enterprise: { ...linked.enterprise, role: "crew" },
    });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.code, "invalid_enterprise");
  });
});
