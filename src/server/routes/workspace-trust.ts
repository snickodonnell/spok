// Shared privileged handler (Track A extraction).
import { existsSync, statSync } from "fs";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { canonicalizePath } from "@/lib/security/paths";
import {
  listTrustedRootEntries,
  listTrustedRoots,
  revokeTrustedRoot,
  trustWorkspaceRoot,
} from "@/lib/security/workspace-trust";


/**
 * Mark a directory as a trusted workspace root for spawn/git operations.
 * Trust is durable under ~/.spok/workspace-trust.json.
 * Requires the local capability token (opening a repo from the UI calls this).
 */
export async function handleTrustPost(req: Request) {
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
    roots: listTrustedRootEntries(),
  });
}

export async function handleTrustGet(req: Request) {
  const auth = authorizePrivilegedRequest(req, "workspace_trust_list");
  if (!auth.ok) return denyFromAuthorize(auth);
  return Response.json({
    trustedRoots: listTrustedRoots(),
    roots: listTrustedRootEntries(),
  });
}

/**
 * Revoke a previously trusted workspace root.
 * Body: `{ path: string }`
 */
export async function handleTrustDelete(req: Request) {
  const auth = authorizePrivilegedRequest(req, "workspace_trust_revoke");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: { path?: string };
  try {
    body = (await req.json()) as { path?: string };
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust_revoke",
    });
  }

  const raw = body.path?.trim();
  if (!raw) {
    return policyDenialResponse(400, {
      error: "path is required",
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust_revoke",
    });
  }

  const root = canonicalizePath(raw);
  const revoked = revokeTrustedRoot(root);
  if (!revoked) {
    return policyDenialResponse(404, {
      error: `Root is not trusted: ${root}`,
      code: "forbidden",
      policy: "workspace_trust",
      action: "workspace_trust_revoke",
      details: { path: root },
    });
  }

  return Response.json({
    ok: true,
    revoked: root,
    trustedRoots: listTrustedRoots(),
    roots: listTrustedRootEntries(),
  });
}
