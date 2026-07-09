import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { loadSchedules } from "@/lib/automation/schedules-fs";
import {
  loadChannels,
  listRecentChannelEvents,
  redactChannelSecret,
} from "@/lib/automation/channels-fs";
import { AUTOMATION_DEFAULTS } from "@/lib/automation/types";
import { listTrustedRoots } from "@/lib/security/workspace-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bundle schedules, channels, policy for the Monitor UI. */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const channels = loadChannels().map((c) => ({
    ...c,
    // Never send full secret to UI by default — partial redaction for display
    secretPreview: redactChannelSecret(c.secret),
    secret: undefined as unknown as string,
  }));

  return Response.json({
    schedules: loadSchedules(),
    channels,
    recentChannelEvents: listRecentChannelEvents(),
    trustedRoots: listTrustedRoots(),
    policy: {
      requireTrustedDefault: true,
      maxConcurrentBackground: AUTOMATION_DEFAULTS.maxConcurrentBackground,
      maxSchedules: AUTOMATION_DEFAULTS.maxSchedules,
      maxChannels: AUTOMATION_DEFAULTS.maxChannels,
    },
  });
}
