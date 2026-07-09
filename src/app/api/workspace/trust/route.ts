import { existsSync, statSync } from "fs";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { canonicalizePath } from "@/lib/security/paths";
import { listTrustedRoots, trustWorkspaceRoot } from "@/lib/security/workspace-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a directory as a trusted workspace root for spawn/git operations.
 * Requires the local capability token (opening a repo from the UI calls this).
 */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "workspace_trust");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { path?: string };
  try {
    body = (await req.json()) as { path?: string };
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust",
    });
  }

  const raw = body.path?.trim();
  if (!raw) {
    return policyDenialResponse(400, {
      error: "path is required",
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust",
    });
  }

  const root = canonicalizePath(raw);
  if (!existsSync(root)) {
    return policyDenialResponse(404, {
      error: `Path does not exist: ${root}`,
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust",
      details: { path: root },
    });
  }

  try {
    if (!statSync(root).isDirectory()) {
      return policyDenialResponse(400, {
        error: "Trusted workspace must be a directory",
        code: "forbidden",
        policy: "workspace_trust",
        action: "workspace_trust",
        details: { path: root },
      });
    }
  } catch {
    return policyDenialResponse(400, {
      error: "Unable to stat path",
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust",
      details: { path: root },
    });
  }

  const trusted = trustWorkspaceRoot(root);
  return Response.json({
    ok: true,
    root: trusted,
    trustedRoots: listTrustedRoots(),
  });
}

export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "workspace_trust_list");
  if (!auth.ok) return denyFromAuthorize(auth);
  return Response.json({ trustedRoots: listTrustedRoots() });
}
