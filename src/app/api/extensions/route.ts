import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { appendAuditEvent } from "@/lib/security/audit";
import { discoverExtensions } from "@/lib/extensions/discover";
import {
  loadProjectExtensionPreferences,
  loadUserExtensionPreferences,
  mergeExtensionPreferences,
  patchPreferences,
  saveProjectExtensionPreferences,
  saveUserExtensionPreferences,
  sanitizePartialPreferences,
  sanitizePreferences,
} from "@/lib/extensions/preferences";
import type { ExtensionPreferences } from "@/lib/extensions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Discover skills, MCP, hooks, plugins, agents for optional cwd. */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "extensions_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || undefined;
  const bundle = discoverExtensions(cwd);
  return Response.json(bundle);
}

/**
 * Update extension preferences (user or project layer).
 * Body fields: layer, cwd, preferences, replace (full replace when true).
 */
export async function PUT(req: Request) {
  const auth = authorizePrivilegedRequest(req, "extensions_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    layer?: "user" | "project";
    cwd?: string;
    preferences?: unknown;
    replace?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "extensions_put",
    });
  }

  const layer = body.layer === "project" ? "project" : "user";
  if (layer === "project" && !body.cwd?.trim()) {
    return Response.json(
      { error: "cwd required for project extension preferences" },
      { status: 400 }
    );
  }

  const current =
    layer === "project"
      ? loadProjectExtensionPreferences(body.cwd)
      : loadUserExtensionPreferences();

  const next: ExtensionPreferences = body.replace
    ? sanitizePreferences(body.preferences)
    : patchPreferences(
        current,
        sanitizePartialPreferences(body.preferences ?? {})
      );

  if (layer === "project") {
    saveProjectExtensionPreferences(body.cwd!, next);
  } else {
    saveUserExtensionPreferences(next);
  }

  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "extensions",
    cwd: body.cwd,
    policy: `extensions:${layer}`,
    decision: "allowed",
    details: {
      layer,
      keys: body.preferences ? Object.keys(body.preferences as object) : [],
    },
  });

  const bundle = discoverExtensions(body.cwd);
  return Response.json({
    ok: true,
    ...bundle,
    layer,
    userPreferences: loadUserExtensionPreferences(),
    projectPreferences: loadProjectExtensionPreferences(body.cwd),
    mergedPreferences: mergeExtensionPreferences(
      loadUserExtensionPreferences(),
      loadProjectExtensionPreferences(body.cwd)
    ),
  });
}
