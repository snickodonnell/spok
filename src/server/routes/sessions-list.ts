// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { createSessionOnDisk, listSessionMetas } from "@/lib/session-store-fs";
import type { Session, SessionMetaRecord } from "@/lib/types";


/** List durable sessions on disk. */
export async function handleSessionsListGet(req: Request) {
  const auth = authorizePrivilegedRequest(req, "sessions_list");
  if (!auth.ok) return denyFromAuthorize(auth);

  const metas = listSessionMetas();
  return Response.json({ sessions: metas });
}

/**
 * Register a new durable session (creates directory + meta + empty logs).
 * Body: { id, name, status, cwd, command, source, grokFlags? }
 */
export async function handleSessionsListPost(req: Request) {
  const auth = authorizePrivilegedRequest(req, "sessions_create");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    id?: string;
    name?: string;
    status?: Session["status"];
    cwd?: string;
    command?: string;
    source?: Session["source"];
    grokFlags?: Record<string, unknown>;
    createdAt?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "sessions_create",
    });
  }

  const id = body.id?.trim();
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    return Response.json(
      { error: "Valid session id required (6–64 alphanumeric/[_-])" },
      { status: 400 }
    );
  }

  const now = Date.now();
  const meta: SessionMetaRecord = createSessionOnDisk({
    id,
    name: body.name || `Session ${new Date(now).toLocaleString()}`,
    status: body.status || "ready",
    createdAt: body.createdAt ?? now,
    updatedAt: now,
    source: body.source || "live",
    cwd: body.cwd || "",
    command: body.command || "grok",
    grokFlags: body.grokFlags,
  });

  return Response.json({ ok: true, session: meta });
}
