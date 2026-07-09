import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import {
  appendNormalizedEvents,
  appendRawEnvelopes,
  readNormalizedEvents,
  sessionExistsOnDisk,
  updateSessionMeta,
} from "@/lib/session-store-fs";
import type { StreamEvent } from "@/lib/types";
import { migrateStreamEvents } from "@/lib/stream-event-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Read normalized event log (replay source of truth). */
export async function GET(req: Request, ctx: Ctx) {
  const auth = authorizePrivilegedRequest(req, "sessions_events_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  if (!sessionExistsOnDisk(id)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const events = readNormalizedEvents(id);
  return Response.json({ events, count: events.length });
}

/**
 * Append normalized events and/or raw log envelopes.
 * Body: { events?: StreamEvent[], raw?: Array<{ kind, data, timestamp? }> }
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = authorizePrivilegedRequest(req, "sessions_events_append");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { id } = await ctx.params;
  if (!sessionExistsOnDisk(id)) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  let body: {
    events?: unknown[];
    raw?: Array<{
      kind?: "stdout" | "stderr" | "line" | "client" | "system";
      data: string;
      timestamp?: number;
    }>;
    status?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "sessions_events_append",
    });
  }

  let eventResult = { appended: 0, eventCount: 0 };
  if (body.events?.length) {
    const { events, errors } = migrateStreamEvents(body.events, {
      sessionId: id,
      provider: "spok",
    });
    const all = [...events, ...errors] as StreamEvent[];
    eventResult = appendNormalizedEvents(id, all);
  }

  let rawResult = { appended: 0, rawCount: 0 };
  if (body.raw?.length) {
    rawResult = appendRawEnvelopes(
      id,
      body.raw.map((r) => ({
        kind: r.kind || "line",
        data: r.data,
        timestamp: r.timestamp || Date.now(),
      }))
    );
  }

  if (body.status) {
    updateSessionMeta(id, {
      status: body.status as never,
      updatedAt: Date.now(),
    });
  }

  return Response.json({
    ok: true,
    events: eventResult,
    raw: rawResult,
  });
}
