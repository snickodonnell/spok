// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { buildDiagnosticsBundle, summarizeDiagnostics } from "@/lib/diagnostics";


/**
 * GET /api/diagnostics — redacted health + environment bundle for support.
 * Requires capability token (privileged).
 */
export async function handleDiagnosticsGet(req: Request) {
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
