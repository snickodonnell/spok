import { timingSafeEqual } from "crypto";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  applyChannelTemplate,
  appendChannelEvent,
  bumpChannelEvent,
  findChannelById,
} from "@/lib/automation/channels-fs";
import { evaluateChannelPolicy } from "@/lib/automation/policy";
import { nanoid } from "nanoid";
import type { ChannelEventRecord } from "@/lib/automation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretsEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Ingest an external event into a channel.
 * Requires capability token + x-spok-channel-secret (or body.secret).
 *
 * Body: { channelId, title?, payload?, secret? }
 *
 * Returns a job blueprint for the client queue (Spok does not spawn from
 * the webhook alone — the open desktop app processes the queue so approval
 * UX stays interactive).
 */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_channel_ingest");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    channelId?: string;
    title?: string;
    payload?: string;
    secret?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON",
      code: "forbidden",
      policy: "local_capability",
      action: "automation_channel_ingest",
    });
  }

  if (!body.channelId?.trim()) {
    return Response.json({ error: "channelId required" }, { status: 400 });
  }

  const channel = findChannelById(body.channelId.trim());
  if (!channel) {
    return Response.json({ error: "Channel not found" }, { status: 404 });
  }

  const provided =
    body.secret?.trim() ||
    req.headers.get("x-spok-channel-secret")?.trim() ||
    "";
  if (!provided || !secretsEqual(provided, channel.secret)) {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      action: "channel_ingest",
      policy: "channel_secret",
      decision: "blocked",
      details: { channelId: channel.id },
    });
    return Response.json({ error: "Invalid channel secret" }, { status: 403 });
  }

  const policy = evaluateChannelPolicy(channel);
  const eventId = `cev-${nanoid(10)}`;
  const payload =
    typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload ?? "");
  const title = body.title?.trim() || "Channel event";

  if (!policy.ok) {
    const record: ChannelEventRecord = {
      id: eventId,
      channelId: channel.id,
      receivedAt: Date.now(),
      title,
      payload: payload.slice(0, 8000),
      status: "rejected",
      reason: policy.reason,
    };
    appendChannelEvent(record);
    return Response.json(
      { ok: false, error: policy.reason, code: policy.code, event: record },
      { status: 403 }
    );
  }

  const prompt = applyChannelTemplate(channel.promptTemplate, {
    title,
    payload: payload.slice(0, 12_000),
    channel: channel.name,
    cwd: channel.cwd,
  });

  bumpChannelEvent(channel.id);
  const record: ChannelEventRecord = {
    id: eventId,
    channelId: channel.id,
    receivedAt: Date.now(),
    title,
    payload: payload.slice(0, 8000),
    status: channel.targetMode === "notify_only" ? "accepted" : "queued",
  };
  appendChannelEvent(record);

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "channel_ingest",
    cwd: channel.cwd,
    policy: "channel_ingest",
    decision: "allowed",
    details: {
      channelId: channel.id,
      targetMode: channel.targetMode,
      eventId,
    },
  });

  return Response.json({
    ok: true,
    event: record,
    jobBlueprint:
      channel.targetMode === "notify_only"
        ? null
        : {
            kind: "channel" as const,
            title: `${channel.name}: ${title}`.slice(0, 80),
            prompt,
            cwd: channel.cwd,
            isolate: channel.isolate,
            channelId: channel.id,
            targetMode: channel.targetMode,
          },
    notify: {
      title: `Channel · ${channel.name}`,
      body: title,
    },
  });
}
