import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { listProcesses } from "@/lib/process-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight poll for phone UI: which harness sessions are live on the host.
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "runtime_live");
  if (!auth.ok) return denyFromAuthorize(auth);

  // listProcesses() prunes dead children
  const processes = listProcesses().map((p) => ({
    sessionId: p.sessionId,
    pid: p.pid,
    command: p.command,
    cwd: p.cwd,
    startedAt: p.startedAt,
    timedOut: p.timedOut ?? false,
    killed: p.killed ?? false,
  }));

  return Response.json({
    ok: true,
    time: Date.now(),
    processes,
    liveSessionIds: processes.map((p) => p.sessionId),
  });
}
