// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import {
  deleteSessionOnDisk,
  readNormalizedEvents,
  readRawEnvelopes,
  readSessionMeta,
  readSnapshot,
  sessionExistsOnDisk,
  updateSessionMeta,
  writeSnapshot,
} from "@/lib/session-store-fs";
import type { Session } from "@/lib/types";


type Ctx = { params: Promise<{ id: string }> };

/** Load session meta + optional snapshot and events for restore. */
export async function handleSessionIdGet(req: Request, ctx: Ctx) {
  const auth = authorizePrivilegedRequest(req, "sessions_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  if (!sessionExistsOnDisk(id)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const includeEvents = url.searchParams.get("events") !== "0";
  const includeSnapshot = url.searchParams.get("snapshot") !== "0";
  const includeRaw = url.searchParams.get("raw") === "1";

  const meta = readSessionMeta(id);
  const snapshot = includeSnapshot ? readSnapshot(id) : null;
  const events = includeEvents ? readNormalizedEvents(id) : [];
  const raw = includeRaw ? readRawEnvelopes(id) : undefined;

  return Response.json({
    meta,
    snapshot,
    events,
    raw,
  });
}

/** Update meta and/or write a materialized snapshot. */
export async function handleSessionIdPut(req: Request, ctx: Ctx) {
  const auth = authorizePrivilegedRequest(req, "sessions_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  if (!sessionExistsOnDisk(id)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  let body: {
    meta?: Partial<{
      name: string;
      status: Session["status"];
      cwd: string;
      command: string;
      source: Session["source"];
      grokFlags: Record<string, unknown>;
      error: string;
      pinned: boolean;
    }>;
    snapshot?: Session;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "sessions_put",
    });
  }

  if (body.snapshot) {
    writeSnapshot(id, { ...body.snapshot, id });
  } else if (body.meta) {
    updateSessionMeta(id, body.meta);
  }

  return Response.json({ ok: true, meta: readSessionMeta(id) });
}

export async function handleSessionIdDelete(req: Request, ctx: Ctx) {
  const auth = authorizePrivilegedRequest(req, "sessions_delete");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  const ok = deleteSessionOnDisk(id);
  return Response.json({ ok, deleted: ok });
}
