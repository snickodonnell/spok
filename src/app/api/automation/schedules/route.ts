import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  deleteSchedule,
  listDueSchedules,
  loadSchedules,
  markScheduleRun,
  upsertSchedule,
} from "@/lib/automation/schedules-fs";
import { evaluateSchedulePolicy } from "@/lib/automation/policy";
import { AUTOMATION_DEFAULTS } from "@/lib/automation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_schedules_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due") === "1";
  const schedules = due ? listDueSchedules() : loadSchedules();

  // Annotate policy for each
  const annotated = schedules.map((s) => ({
    ...s,
    policy: evaluateSchedulePolicy(s),
  }));

  return Response.json({ schedules: annotated });
}

/** Create or update a schedule. */
export async function PUT(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_schedules_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON",
      code: "forbidden",
      policy: "local_capability",
      action: "automation_schedules_put",
    });
  }

  const existing = loadSchedules();
  const isNew =
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    !existing.some(
      (s) => s.id === (body as { id?: string }).id
    );
  if (isNew && existing.length >= AUTOMATION_DEFAULTS.maxSchedules) {
    return Response.json(
      { error: `Max ${AUTOMATION_DEFAULTS.maxSchedules} schedules` },
      { status: 400 }
    );
  }

  const result = upsertSchedule(body);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "schedule",
    cwd: result.schedule.cwd,
    policy: "automation:schedule_upsert",
    decision: "allowed",
    details: { id: result.schedule.id, name: result.schedule.name },
  });

  return Response.json({
    ok: true,
    schedule: result.schedule,
    schedules: result.all,
    policy: evaluateSchedulePolicy(result.schedule),
  });
}

/** Delete schedule or mark a run. */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_schedules_post");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    action?: string;
    id?: string;
    lastJobId?: string;
    lastStatus?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON",
      code: "forbidden",
      policy: "local_capability",
      action: "automation_schedules_post",
    });
  }

  if (body.action === "mark_run" && body.id) {
    const updated = markScheduleRun(body.id, {
      lastRunAt: Date.now(),
      lastJobId: body.lastJobId,
      lastStatus: body.lastStatus as
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "skipped"
        | "cancelled"
        | undefined,
    });
    if (!updated) {
      return Response.json({ error: "Schedule not found" }, { status: 404 });
    }
    return Response.json({ ok: true, schedule: updated });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_schedules_delete");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const schedules = deleteSchedule(id);
  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "schedule",
    policy: "automation:schedule_delete",
    decision: "allowed",
    details: { id },
  });
  return Response.json({ ok: true, schedules });
}
