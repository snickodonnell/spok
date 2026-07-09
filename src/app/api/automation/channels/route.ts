import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  deleteChannel,
  loadChannels,
  redactChannelSecret,
  upsertChannel,
} from "@/lib/automation/channels-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_channels_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const reveal = new URL(req.url).searchParams.get("reveal") === "1";
  const channels = loadChannels().map((c) => ({
    ...c,
    secretPreview: redactChannelSecret(c.secret),
    secret: reveal ? c.secret : undefined,
  }));
  return Response.json({ channels });
}

export async function PUT(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_channels_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON",
      code: "forbidden",
      policy: "local_capability",
      action: "automation_channels_put",
    });
  }

  const result = upsertChannel(body);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "channel",
    cwd: result.channel.cwd,
    policy: "automation:channel_upsert",
    decision: "allowed",
    details: { id: result.channel.id, name: result.channel.name },
  });

  return Response.json({
    ok: true,
    channel: {
      ...result.channel,
      secretPreview: redactChannelSecret(result.channel.secret),
      // Return full secret once on create so user can copy
      secret: result.channel.secret,
    },
    channels: result.all.map((c) => ({
      ...c,
      secretPreview: redactChannelSecret(c.secret),
      secret: undefined,
    })),
  });
}

export async function DELETE(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_channels_delete");
  if (!auth.ok) return denyFromAuthorize(auth);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const channels = deleteChannel(id);
  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "channel",
    policy: "automation:channel_delete",
    decision: "allowed",
    details: { id },
  });
  return Response.json({
    ok: true,
    channels: channels.map((c) => ({
      ...c,
      secretPreview: redactChannelSecret(c.secret),
      secret: undefined,
    })),
  });
}
