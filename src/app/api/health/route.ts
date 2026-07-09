import {
  getLocalCapabilityToken,
  isLocalHostAllowed,
  isOriginAllowed,
  policyDenialResponse,
} from "@/lib/security/local-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local bootstrap endpoint. Issues the per-process capability token only when
 * Host/Origin look like the local Spok app. Remote callers get a denial without a token.
 */
export async function GET(req: Request) {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");

  if (!isLocalHostAllowed(host) || !isOriginAllowed(origin, host)) {
    return policyDenialResponse(403, {
      error: "Health token is only available to the local Spok app",
      code: "invalid_origin",
      policy: "origin_host",
      action: "health_token",
      details: { host, origin },
    });
  }

  return Response.json({
    ok: true,
    name: "spok",
    version: "0.1.0",
    time: Date.now(),
    localToken: getLocalCapabilityToken(),
  });
}
