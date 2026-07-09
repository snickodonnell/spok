import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import {
  clearApprovalGrants,
  decideApproval,
  getPendingApproval,
  listApprovalGrants,
  revokeGrant,
} from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";
import type { ApprovalDecision } from "@/lib/settings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "approvals_list");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    const pending = getPendingApproval(id);
    if (!pending) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ pending });
  }

  return Response.json({ grants: listApprovalGrants() });
}

/**
 * Record an approval decision for a pending request.
 * Body: { requestId, decision: allow_once | allow_always | deny }
 */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "approvals_decide");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { requestId?: string; decision?: ApprovalDecision };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "approvals_decide",
    });
  }

  if (!body.requestId || !body.decision) {
    return Response.json(
      { error: "requestId and decision required" },
      { status: 400 }
    );
  }

  if (!["allow_once", "allow_always", "deny"].includes(body.decision)) {
    return Response.json({ error: "Invalid decision" }, { status: 400 });
  }

  const pending = getPendingApproval(body.requestId);
  const result = decideApproval(body.requestId, body.decision);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 404 });
  }

  appendAuditEvent({
    type: "approval_decision",
    timestamp: Date.now(),
    sessionId: pending?.sessionId,
    action: pending?.action ?? "spawn",
    cwd: pending?.cwd,
    command: pending?.command,
    args: pending?.args,
    profile: pending?.profile,
    policy: pending?.policy,
    decision: body.decision,
    risk: pending?.risk,
    details: { requestId: body.requestId },
  });

  return Response.json({
    ok: true,
    decision: body.decision,
    grant: result.grant,
    onceToken: result.onceToken,
    grants: listApprovalGrants(),
  });
}

export async function DELETE(req: Request) {
  const auth = authorizePrivilegedRequest(req, "approvals_revoke");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all") === "1";

  if (all) {
    clearApprovalGrants();
    appendAuditEvent({
      type: "settings_change",
      timestamp: Date.now(),
      action: "approvals",
      decision: "allowed",
      policy: "grants_cleared",
    });
    return Response.json({ ok: true, grants: [] });
  }

  if (!id) {
    return Response.json({ error: "id or all=1 required" }, { status: 400 });
  }

  const ok = revokeGrant(id);
  return Response.json({ ok, grants: listApprovalGrants() });
}
