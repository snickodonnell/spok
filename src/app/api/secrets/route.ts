import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import {
  deleteSecret,
  listSecretIds,
  readSecret,
  writeSecret,
} from "@/lib/security/secrets-vault";
import { appendAuditEvent } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local secrets vault — values never returned in list; read requires explicit id.
 * Intended for API tokens that should not live in plain settings JSON.
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "secrets_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const value = readSecret(id);
    if (value === null) {
      return Response.json({ error: "Secret not found", code: "not_found" }, { status: 404 });
    }
    return Response.json({ id, value, present: true });
  }

  return Response.json({ ids: listSecretIds() });
}

export async function PUT(req: Request) {
  const auth = authorizePrivilegedRequest(req, "secrets_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { id?: string; value?: string };
  try {
    body = (await req.json()) as { id?: string; value?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id || typeof body.value !== "string") {
    return Response.json(
      { error: "id and value are required" },
      { status: 400 }
    );
  }
  if (body.value.length > 64_000) {
    return Response.json({ error: "Secret too large (max 64KB)" }, { status: 400 });
  }

  const result = writeSecret(id, body.value);
  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "secrets_write",
    decision: "allowed",
    details: { id: result.id, bytes: result.bytes },
  });

  return Response.json({ ok: true, id: result.id });
}

export async function DELETE(req: Request) {
  const auth = authorizePrivilegedRequest(req, "secrets_delete");
  if (!auth.ok) return denyFromAuthorize(auth);

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const removed = deleteSecret(id);
  if (removed) {
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      action: "secrets_delete",
      decision: "allowed",
      details: { id },
    });
  }
  return Response.json({ ok: true, removed });
}
