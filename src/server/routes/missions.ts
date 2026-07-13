/**
 * Mission v1 privileged routes.
 * Reading/importing missions is authority-neutral (no trust grant).
 */

import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  checkpointMission,
  createMission,
  importMission,
  listMissions,
  materializeCheckpoint,
  MISSION_SCHEMA_VERSION,
  readCheckpoint,
  readMission,
  writeMission,
} from "@/lib/missions";

function invalidJson(action: string): Response {
  return policyDenialResponse(400, {
    error: "Invalid JSON",
    code: "forbidden",
    policy: "local_capability",
    action,
  });
}

function domainErrorStatus(code: string): number {
  if (code === "not_found") return 404;
  if (code === "conflict") return 409;
  if (
    code === "authority_over_request" ||
    code === "budget_exhausted" ||
    code === "budget_over_parent" ||
    code === "retry_exhausted" ||
    code === "missing_evidence"
  ) {
    return 400;
  }
  return 400;
}

/** GET /api/missions — list mission metas (authority-neutral read). */
export function handleMissionsGet(req: Request): Response {
  const auth = authorizePrivilegedRequest(req, "missions_list");
  if (!auth.ok) return denyFromAuthorize(auth);

  const missions = listMissions();
  return Response.json(
    {
      version: MISSION_SCHEMA_VERSION,
      missions,
      /** Explicit: listing does not grant workspace trust or execution authority. */
      authorityNeutral: true,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

/** POST /api/missions — create or import a mission. */
export async function handleMissionsPost(req: Request): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "missions_create");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    mission?: unknown;
    import?: boolean;
    source?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return invalidJson("missions_create");
  }

  if (body.import === true) {
    const result = importMission(body.mission, body.source);
    if (!result.ok) {
      return Response.json(
        { error: result.error, code: result.code },
        { status: domainErrorStatus(result.code) }
      );
    }
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      action: "mission_import",
      cwd: result.value.repository,
      policy: "missions:import_authority_neutral",
      decision: "allowed",
      details: {
        missionId: result.value.id,
        authorityNeutral: true,
        status: result.value.status,
      },
    });
    return Response.json({
      ok: true,
      version: MISSION_SCHEMA_VERSION,
      mission: result.value,
      authorityNeutral: true,
    });
  }

  if (!body.mission || typeof body.mission !== "object") {
    return Response.json(
      { error: "Body requires mission object", code: "invalid_mission" },
      { status: 400 }
    );
  }

  const result = createMission(body.mission as Parameters<typeof createMission>[0]);
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: domainErrorStatus(result.code) }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "mission_create",
    cwd: result.value.repository,
    policy: "missions:create",
    decision: "allowed",
    details: {
      missionId: result.value.id,
      status: result.value.status,
      // Creating a mission record does not grant trust
      trustGranted: false,
    },
  });

  return Response.json({
    ok: true,
    version: MISSION_SCHEMA_VERSION,
    mission: result.value,
    authorityNeutral: true,
  });
}

/** GET /api/missions/:id — read one mission (authority-neutral). */
export async function handleMissionIdGet(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  const mission = readMission(id);
  if (!mission) {
    return Response.json(
      { error: `Mission ${id} not found`, code: "not_found" },
      { status: 404 }
    );
  }

  return Response.json(
    {
      version: MISSION_SCHEMA_VERSION,
      mission,
      authorityNeutral: true,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

/** PUT /api/missions/:id — replace mission document (validated). */
export async function handleMissionIdPut(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  let body: { mission?: unknown };
  try {
    body = (await req.json()) as { mission?: unknown };
  } catch {
    return invalidJson("mission_put");
  }

  if (!body.mission || typeof body.mission !== "object") {
    return Response.json(
      { error: "Body requires mission object", code: "invalid_mission" },
      { status: 400 }
    );
  }

  const existing = readMission(id);
  if (!existing) {
    return Response.json(
      { error: `Mission ${id} not found`, code: "not_found" },
      { status: 404 }
    );
  }

  const candidate = {
    ...(body.mission as object),
    id,
    createdAt: existing.createdAt,
  };
  const result = writeMission(candidate as Parameters<typeof writeMission>[0]);
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: domainErrorStatus(result.code) }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "mission_write",
    cwd: result.value.repository,
    policy: "missions:write",
    decision: "allowed",
    details: {
      missionId: result.value.id,
      status: result.value.status,
      trustGranted: false,
    },
  });

  return Response.json({
    ok: true,
    version: MISSION_SCHEMA_VERSION,
    mission: result.value,
    authorityNeutral: true,
  });
}

/**
 * GET /api/missions/:id/checkpoint — latest checkpoint or materialize projection.
 * POST — materialize + persist checkpoint without transcript replay.
 */
export async function handleMissionCheckpointGet(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_checkpoint_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  const mission = readMission(id);
  if (!mission) {
    return Response.json(
      { error: `Mission ${id} not found`, code: "not_found" },
      { status: 404 }
    );
  }

  const url = new URL(req.url);
  const checkpointId =
    url.searchParams.get("checkpointId") || mission.checkpointRef;

  if (checkpointId) {
    const checkpoint = readCheckpoint(id, checkpointId);
    if (checkpoint) {
      return Response.json(
        {
          version: MISSION_SCHEMA_VERSION,
          missionId: id,
          checkpoint,
          authorityNeutral: true,
        },
        { headers: { "cache-control": "no-store" } }
      );
    }
  }

  // Pure materialization without requiring prior persist
  const checkpoint = materializeCheckpoint({ mission });
  return Response.json(
    {
      version: MISSION_SCHEMA_VERSION,
      missionId: id,
      checkpoint,
      persisted: false,
      authorityNeutral: true,
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function handleMissionCheckpointPost(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_checkpoint_post");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  let body: {
    changedAssumptions?: string[];
    risks?: string[];
    nextDecisions?: string[];
  } = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as typeof body;
    }
  } catch {
    return invalidJson("mission_checkpoint_post");
  }

  const result = checkpointMission(id, {
    changedAssumptions: body.changedAssumptions,
    risks: body.risks,
    nextDecisions: body.nextDecisions,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code },
      { status: domainErrorStatus(result.code) }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "mission_checkpoint",
    cwd: result.value.mission.repository,
    policy: "missions:checkpoint",
    decision: "allowed",
    details: {
      missionId: id,
      checkpointId: result.value.checkpoint.id,
      trustGranted: false,
    },
  });

  return Response.json({
    ok: true,
    version: MISSION_SCHEMA_VERSION,
    mission: result.value.mission,
    checkpoint: result.value.checkpoint,
    authorityNeutral: true,
  });
}
