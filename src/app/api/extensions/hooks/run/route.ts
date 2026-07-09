import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { discoverExtensions } from "@/lib/extensions/discover";
import { runHooks } from "@/lib/extensions/hooks";
import type { HookEvent } from "@/lib/extensions/types";
import { getResolvedSettings } from "@/lib/settings/settings-fs";
import { isTrustedWorkspacePath } from "@/lib/security/workspace-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set<HookEvent>([
  "session_start",
  "session_end",
  "prompt_submit",
  "pre_tool_use",
  "post_tool_use",
  "permission_request",
  "file_changed",
  "stop",
  "subagent_start",
  "subagent_end",
]);

/**
 * POST run hooks for a lifecycle event.
 * Body: { event, sessionId, cwd?, vars?, hookIds? }
 */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "extensions_hooks_run");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    event?: string;
    sessionId?: string;
    cwd?: string;
    vars?: Record<string, string>;
    hookIds?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "extensions_hooks_run",
    });
  }

  if (!body.sessionId?.trim()) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!body.event || !EVENTS.has(body.event as HookEvent)) {
    return Response.json({ error: "valid event required" }, { status: 400 });
  }

  const cwd = body.cwd?.trim() || undefined;
  if (cwd && !isTrustedWorkspacePath(cwd)) {
    // Allow hook trace events without trust, but never run command hooks outside trust
    // (runHooks already gates command hooks via policy; still require trust for cwd-bound runs)
  }

  const bundle = discoverExtensions(cwd);
  const settings = getResolvedSettings(cwd);
  const results = await runHooks(
    {
      event: body.event as HookEvent,
      sessionId: body.sessionId,
      cwd,
      vars: body.vars,
      hookIds: body.hookIds,
    },
    bundle.hooks,
    settings
  );

  return Response.json({
    ok: true,
    event: body.event,
    results,
    eventCount: results.reduce((n, r) => n + r.events.length, 0),
  });
}
