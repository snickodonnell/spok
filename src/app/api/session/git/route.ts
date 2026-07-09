import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import { getResolvedSettings } from "@/lib/settings/settings-fs";
import { evaluatePolicy } from "@/lib/security/permission-policy";
import { getActiveGrants } from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";
import { trustWorkspaceRoot } from "@/lib/security/workspace-trust";
import { isGitAction, gitRiskProfile } from "@/lib/git/risk";
import { executeGitAction } from "@/lib/git/operations";
import { collectGitStatus } from "@/lib/git/status";
import type { GitActionRequest, GitOpRisk } from "@/lib/git/types";
import type { RiskLevel } from "@/lib/settings/types";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toRiskLevel(risk: GitOpRisk): RiskLevel {
  switch (risk) {
    case "read":
      return "low";
    case "write":
      return "medium";
    case "network":
      return "high";
    case "destructive":
      return "critical";
  }
}

/**
 * GET — accurate status snapshot (branch, porcelain, worktree flags).
 * Query: cwd
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "git_status");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const rawCwd = searchParams.get("cwd") || "";
  const trust = requireTrustedCwd(rawCwd);
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "git",
      details: { cwd: trust.path },
    });
  }

  const settings = getResolvedSettings(trust.path);
  const policy = evaluatePolicy({
    settings,
    action: "git",
    cwd: trust.path,
    command: "git",
    args: ["status"],
    grants: getActiveGrants(),
  });
  if (policy.decision === "deny") {
    return policyDenialResponse(403, {
      error: policy.reason,
      code: "command_not_allowed",
      policy: "command_profile",
      action: "git",
      details: { policy: policy.policy },
    });
  }

  const status = await collectGitStatus(trust.path);
  return Response.json(status);
}

/**
 * POST — closed-set git mutations and queries.
 * Body: GitActionRequest
 */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "git_action");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: GitActionRequest;
  try {
    body = (await req.json()) as GitActionRequest;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.action || !isGitAction(body.action)) {
    return Response.json(
      { ok: false, error: "Unknown or missing git action", code: "unknown_action" },
      { status: 400 }
    );
  }

  if (!body.cwd || typeof body.cwd !== "string") {
    return Response.json(
      { ok: false, error: "cwd is required", code: "cwd_required" },
      { status: 400 }
    );
  }

  const trust = requireTrustedCwd(body.cwd);
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "git",
      details: { cwd: trust.path },
    });
  }

  const profile = gitRiskProfile(body.action);
  const settings = getResolvedSettings(trust.path);
  const policy = evaluatePolicy({
    settings,
    action: "git",
    cwd: trust.path,
    command: "git",
    args: [body.action, ...(body.paths ?? [])],
    path: body.paths?.[0],
    grants: getActiveGrants(),
  });

  // Plan mode: block non-read git ops even if broad allow-git rule exists
  if (
    settings.permissionMode === "plan" &&
    !profile.allowedInPlan
  ) {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      sessionId: body.sessionId,
      action: "git",
      cwd: trust.path,
      command: "git",
      args: [body.action],
      policy: "mode:plan",
      decision: "blocked",
      risk: toRiskLevel(profile.risk),
      details: { reason: "Plan mode blocks git writes", gitAction: body.action },
    });
    return policyDenialResponse(403, {
      error: `Plan / read-only mode blocks ${profile.label.toLowerCase()}`,
      code: "command_not_allowed",
      policy: "command_profile",
      action: "git",
      details: {
        policy: "mode:plan",
        gitAction: body.action,
        risk: profile.risk,
      },
    });
  }

  if (policy.decision === "deny") {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      sessionId: body.sessionId,
      action: "git",
      cwd: trust.path,
      command: "git",
      args: [body.action],
      policy: policy.policy,
      decision: "blocked",
      risk: toRiskLevel(profile.risk),
      details: { reason: policy.reason, gitAction: body.action },
    });
    return policyDenialResponse(403, {
      error: policy.reason,
      code: "command_not_allowed",
      policy: "command_profile",
      action: "git",
      details: { policy: policy.policy, gitAction: body.action },
    });
  }

  const result = await executeGitAction({
    ...body,
    cwd: trust.path,
  });

  const auditId = nanoid(10);
  const isWrite = profile.risk !== "read";

  // Don't audit "needs confirmation" as a blocked runtime action — client will re-submit.
  if (isWrite && !result.needsConfirm) {
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      sessionId: body.sessionId,
      action: "git",
      cwd: trust.path,
      paths: body.paths,
      command: "git",
      args: [body.action, ...(body.paths ?? []).slice(0, 20)],
      policy: policy.policy,
      decision: result.ok ? "allowed" : "blocked",
      risk: toRiskLevel(profile.risk),
      details: {
        auditId,
        gitAction: body.action,
        confirm: !!body.confirm,
        error: result.error,
        branch: body.branch,
        worktreePath:
          result.createdWorktree?.path ?? body.worktreePath,
        amend: body.amend,
        force: body.force,
      },
    });
  }

  // Auto-trust newly created worktrees (absolute path from executor)
  if (
    result.ok &&
    body.action === "worktree_add" &&
    body.trustWorktree !== false
  ) {
    const trustPath = result.createdWorktree?.path ?? body.worktreePath;
    if (trustPath) {
      try {
        trustWorkspaceRoot(trustPath);
      } catch {
        /* non-fatal */
      }
    }
  }

  const httpStatus = result.needsConfirm ? 409 : result.ok ? 200 : 400;
  return Response.json(
    {
      ...result,
      auditId,
      risk: profile.risk,
    },
    { status: httpStatus }
  );
}
