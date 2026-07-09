import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { buildDiagnosticsBundle, summarizeDiagnostics } from "@/lib/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics — redacted health + environment bundle for support.
 * Requires capability token (privileged).
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "diagnostics");
  if (!auth.ok) return denyFromAuthorize(auth);

  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd") || undefined;
  const bundle = buildDiagnosticsBundle({ cwd });
  const summary = summarizeDiagnostics(bundle);

  return Response.json({
    ok: summary.error === 0,
    summary,
    diagnostics: bundle,
  });
}
