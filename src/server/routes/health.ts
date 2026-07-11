// Shared privileged handler (Track A extraction).
import {
  getLocalCapabilityToken,
  isLanAccessEnabled,
  isLocalHostAllowed,
  isOriginAllowed,
  policyDenialResponse,
} from "@/lib/security/local-api";


/**
 * Local bootstrap endpoint. Issues the per-process capability token only when
 * Host/Origin look like the Spok app (loopback, or private LAN if SPOK_LAN_ACCESS=1).
 * Public / unexpected hosts get a denial without a token.
 */
export async function handleHealthGet(req: Request) {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");

  if (!isLocalHostAllowed(host) || !isOriginAllowed(origin, host)) {
    return policyDenialResponse(403, {
      error:
        "Health token is only available to the local Spok app (or LAN when SPOK_LAN_ACCESS=1)",
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
    runtime: "node",
    pid: process.pid,
    time: Date.now(),
    localToken: getLocalCapabilityToken(),
    lanAccess: isLanAccessEnabled(),
  });
}
