// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { probeCliStatus } from "@/lib/runtime/cli-status";


/**
 * GET /api/runtime/cli-status?command=grok
 * Presence + version probe only. Does not check Grok login state.
 */
export async function handleCliStatusGet(req: Request) {
  const auth = authorizePrivilegedRequest(req, "cli_status");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const command =
    searchParams.get("command")?.trim() ||
    process.env.SPOK_GROK_CMD?.trim() ||
    "grok";

  const status = await probeCliStatus(command);
  return Response.json({
    ok: status.found,
    status,
    /**
     * Explicit product contract: Spok never owns Grok OAuth/API-key login.
     * Users authenticate with the native CLI before launching Spok.
     */
    authModel: "external_cli",
  });
}
