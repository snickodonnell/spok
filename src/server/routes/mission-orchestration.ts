import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import {
  compileMissionReceiptBundle,
  MissionReceiptError,
  parseMissionScheduleInput,
  readMission,
  readMissionReceiptBundle,
  saveMissionReceiptBundle,
  scheduleMissionReceipts,
} from "@/lib/missions";
import { MISSION_SAFE_ID } from "@/lib/missions/types";
import { existsSync } from "fs";

type RouteContext = { params: Promise<{ id: string }> };

export async function handleMissionReceiptsGet(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_receipts_read");
  if (!auth.ok) return denyFromAuthorize(auth);
  const missionId = (await ctx.params).id;
  const receiptId = new URL(req.url).searchParams.get("receiptId") || "";
  if (!MISSION_SAFE_ID.test(missionId) || !MISSION_SAFE_ID.test(receiptId)) {
    return Response.json({ error: "Valid mission id and receiptId required" }, { status: 400 });
  }
  const bundle = readMissionReceiptBundle(missionId, receiptId);
  return bundle
    ? Response.json({ bundle })
    : Response.json({ error: "Receipt bundle not found" }, { status: 404 });
}

export async function handleMissionReceiptsPost(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_receipts_compile");
  if (!auth.ok) return denyFromAuthorize(auth);
  const missionId = (await ctx.params).id;
  const mission = MISSION_SAFE_ID.test(missionId) ? readMission(missionId) : null;
  if (!mission) return Response.json({ error: "Mission not found" }, { status: 404 });
  const trust = requireTrustedCwd(mission.repository);
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "mission_receipts_compile",
      details: { missionId, cwd: trust.path },
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const bundle = compileMissionReceiptBundle(mission, body);
    for (const receipt of bundle.workItems) {
      const worktreeTrust = requireTrustedCwd(receipt.execution.cwd);
      if (!worktreeTrust.ok) {
        throw new MissionReceiptError(
          "isolation",
          `Work item ${receipt.workItemId} worktree is not trusted: ${worktreeTrust.reason}`
        );
      }
    }
    saveMissionReceiptBundle(bundle);
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      action: "mission_receipts_compile",
      cwd: mission.repository,
      decision: "allowed",
      details: {
        missionId,
        receiptId: bundle.mission.id,
        workItemIds: bundle.workItems.map((item) => item.workItemId),
        budget: bundle.mission.budget,
      },
    });
    return Response.json({ bundle }, { status: 201 });
  } catch (error) {
    if (!(error instanceof MissionReceiptError)) throw error;
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      action: "mission_receipts_compile",
      cwd: mission.repository,
      decision: "blocked",
      policy: "delegated_authority",
      details: { missionId, code: error.code, issues: error.issues },
    });
    return policyDenialResponse(400, {
      error: error.message,
      code: "invalid_receipt",
      policy: "provider_contract",
      action: "mission_receipts_compile",
      details: { missionId, receiptCode: error.code, issues: error.issues },
    });
  }
}

export async function handleMissionSchedulePost(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "mission_schedule");
  if (!auth.ok) return denyFromAuthorize(auth);
  const missionId = (await ctx.params).id;
  const mission = MISSION_SAFE_ID.test(missionId) ? readMission(missionId) : null;
  if (!mission) return Response.json({ error: "Mission not found" }, { status: 404 });
  const trust = requireTrustedCwd(mission.repository);
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "mission_schedule",
      details: { missionId, cwd: trust.path },
    });
  }
  let body: { receiptId?: string; schedule?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const receiptId = body.receiptId?.trim() || "";
  const bundle = readMissionReceiptBundle(missionId, receiptId);
  if (!bundle) return Response.json({ error: "Receipt bundle not found" }, { status: 404 });
  try {
    const input = parseMissionScheduleInput(body.schedule);
    const verifiedIsolation = Object.fromEntries(
      bundle.workItems.map((receipt) => {
        const worktreeTrust = requireTrustedCwd(receipt.execution.cwd);
        return [
          receipt.workItemId,
          input.verifiedIsolation?.[receipt.workItemId] === true &&
            worktreeTrust.ok &&
            existsSync(receipt.execution.cwd),
        ];
      })
    );
    const schedule = scheduleMissionReceipts(bundle, { ...input, verifiedIsolation });
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      action: "mission_schedule",
      cwd: mission.repository,
      decision: "allowed",
      details: {
        missionId,
        receiptId,
        selected: schedule.selected,
        capacity: schedule.capacity,
        budget: schedule.budget,
      },
    });
    return Response.json({ schedule });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid schedule input" },
      { status: 400 }
    );
  }
}
