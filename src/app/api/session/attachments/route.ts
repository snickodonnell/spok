/**
 * Session-scoped prompt attachments.
 *
 * POST   multipart: sessionId + files[]  → { attachments: AttachmentMeta[] }
 * DELETE ?sessionId=&attachmentId=       → { ok }
 * GET    ?sessionId=                     → { attachments: AttachmentMeta[] }
 *
 * Files are stored under ~/.spok/sessions/<id>/attachments/ and are not
 * exposed via the workspace fs/browse route.
 */

import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  ATTACHMENT_LIMITS,
  deleteAttachment,
  listAttachmentMetas,
  saveAttachmentBytes,
  type AttachmentMeta,
} from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "session_attachments_list");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId || !/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const attachments = listAttachmentMetas(sessionId);
    return Response.json({ attachments });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "List failed" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "session_attachments_upload");
  if (!auth.ok) return denyFromAuthorize(auth);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return policyDenialResponse(400, {
      error: "Expected multipart form data",
      code: "forbidden",
      policy: "local_capability",
      action: "session_attachments_upload",
    });
  }

  const sessionId = String(form.get("sessionId") ?? "").trim();
  if (!sessionId || !/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((f): f is File => typeof File !== "undefined" && f instanceof File);

  // Also accept single "file" field
  const single = form.get("file");
  if (typeof File !== "undefined" && single instanceof File) {
    files.push(single);
  }

  if (!files.length) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }
  if (files.length > ATTACHMENT_LIMITS.maxFiles) {
    return Response.json(
      {
        error: `Too many files (max ${ATTACHMENT_LIMITS.maxFiles} per upload)`,
      },
      { status: 400 }
    );
  }

  const saved: AttachmentMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const ab = await file.arrayBuffer();
      const data = Buffer.from(ab);
      const meta = saveAttachmentBytes(sessionId, {
        name: file.name || "file",
        mimeType: file.type,
        data,
      });
      saved.push(meta);
    } catch (e) {
      errors.push(
        `${file.name || "file"}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    sessionId,
    action: "attachment_upload",
    decision: saved.length ? "allowed" : "blocked",
    details: {
      count: saved.length,
      names: saved.map((s) => s.name),
      errors: errors.length ? errors : undefined,
    },
  });

  if (!saved.length) {
    return Response.json(
      { error: errors.join("; ") || "Upload failed", errors },
      { status: 400 }
    );
  }

  return Response.json({
    attachments: saved,
    errors: errors.length ? errors : undefined,
  });
}

export async function DELETE(req: Request) {
  const auth = authorizePrivilegedRequest(req, "session_attachments_delete");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  const attachmentId = searchParams.get("attachmentId")?.trim() ?? "";
  if (!sessionId || !attachmentId) {
    return Response.json(
      { error: "sessionId and attachmentId required" },
      { status: 400 }
    );
  }

  try {
    const ok = deleteAttachment(sessionId, attachmentId);
    if (ok) {
      appendAuditEvent({
        type: "runtime_action",
        timestamp: Date.now(),
        sessionId,
        action: "attachment_delete",
        decision: "allowed",
        details: { attachmentId },
      });
    }
    return Response.json({ ok });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 400 }
    );
  }
}
