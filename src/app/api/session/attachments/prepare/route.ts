/**
 * Prepare a Grok --prompt-file JSON payload for a turn with attachments.
 *
 * Body: { sessionId, turnId?, prompt, attachmentIds, baseArgs? }
 * Returns: { args, attachments, warnings } — absolute prompt path is only
 * embedded inside args for the spawn path (not a separate user-facing field
 * beyond what's needed for the harness).
 */

import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import { prepareAttachedRun } from "@/lib/attachments";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "session_attachments_prepare");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    sessionId?: string;
    turnId?: string;
    prompt?: string;
    attachmentIds?: string[];
    baseArgs?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "session_attachments_prepare",
    });
  }

  const sessionId = body.sessionId?.trim() ?? "";
  if (!sessionId || !/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id): id is string => typeof id === "string")
    : [];
  if (!attachmentIds.length) {
    return Response.json(
      { error: "attachmentIds required (use plain -p when no attachments)" },
      { status: 400 }
    );
  }

  const baseArgs = Array.isArray(body.baseArgs)
    ? body.baseArgs.map((a) => String(a))
    : [];

  try {
    const prepared = prepareAttachedRun({
      sessionId,
      turnId: body.turnId?.trim() || nanoid(8),
      prompt,
      attachmentIds,
      baseArgs,
    });

    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      sessionId,
      action: "attachment_prepare",
      decision: "allowed",
      details: {
        count: prepared.metas.length,
        names: prepared.metas.map((m) => m.name),
        warnings: prepared.warnings,
      },
    });

    // Do not return absolute promptFile as a top-level display field; args
    // contain --prompt-file for the harness spawn only.
    return Response.json({
      args: prepared.args,
      attachments: prepared.metas.map((m) => ({
        id: m.id,
        name: m.name,
        mimeType: m.mimeType,
        kind: m.kind,
        size: m.size,
      })),
      warnings: prepared.warnings,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Prepare failed" },
      { status: 400 }
    );
  }
}
