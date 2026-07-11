import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  AUTOMATION_JOBS_SCHEMA_VERSION,
  loadAutomationJobLedger,
  replaceAutomationJobs,
  upsertAutomationJob,
} from "@/lib/automation/jobs-fs";

function invalidJson(action: string): Response {
  return policyDenialResponse(400, {
    error: "Invalid JSON",
    code: "forbidden",
    policy: "local_capability",
    action,
  });
}

/** Load the durable ledger once during client boot and reconcile stale runs. */
export function handleAutomationJobsGet(req: Request): Response {
  const auth = authorizePrivilegedRequest(req, "automation_jobs_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const ledger = loadAutomationJobLedger({ reconcile: true });
  return Response.json(
    {
      version: AUTOMATION_JOBS_SCHEMA_VERSION,
      ...ledger,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

/** Upsert one transition/linkage record. */
export async function handleAutomationJobsPost(req: Request): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "automation_jobs_post");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { job?: unknown };
  try {
    body = (await req.json()) as { job?: unknown };
  } catch {
    return invalidJson("automation_jobs_post");
  }
  const result = upsertAutomationJob(body.job);
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: result.code === "untrusted_cwd" ? 403 : 400 }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    sessionId: result.job.sessionId,
    action: "automation_job_write",
    cwd: result.job.cwd,
    paths: [result.job.worktreePath, result.job.mainCheckout].filter(
      (value): value is string => !!value
    ),
    policy: "automation:durable_job",
    decision: "allowed",
    details: {
      jobId: result.job.id,
      status: result.job.status,
      branch: result.job.branch,
      outcome: result.job.outcome?.kind,
    },
  });

  return Response.json({
    ok: true,
    version: AUTOMATION_JOBS_SCHEMA_VERSION,
    job: result.job,
  });
}

/** Replace the capped ledger after debounced client state changes/removals. */
export async function handleAutomationJobsPut(req: Request): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "automation_jobs_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { jobs?: unknown };
  try {
    body = (await req.json()) as { jobs?: unknown };
  } catch {
    return invalidJson("automation_jobs_put");
  }
  const result = replaceAutomationJobs(body.jobs);
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: result.code === "untrusted_cwd" ? 403 : 400 }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "automation_job_write",
    policy: "automation:durable_job_ledger",
    decision: "allowed",
    details: { count: result.jobs.length },
  });
  return Response.json({
    ok: true,
    version: AUTOMATION_JOBS_SCHEMA_VERSION,
    jobs: result.jobs,
  });
}
