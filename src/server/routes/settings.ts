// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import {
  getResolvedSettings,
  loadProjectSettings,
  loadUserSettings,
  resolveSettings,
  saveProjectSettings,
  saveUserSettings,
  resetUserSettings,
  loadManagedSettings,
} from "@/lib/settings/settings-fs";
import { sanitizePartialSettings } from "@/lib/settings/merge";
import { DEFAULT_COMMAND_PROFILES } from "@/lib/settings/defaults";
import { PERMISSION_MODE_META } from "@/lib/settings/defaults";
import { listApprovalGrants } from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";


/** Resolve layered settings for optional cwd. */
export async function handleSettingsGet(req: Request) {
  const auth = authorizePrivilegedRequest(req, "settings_get");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const bundle = resolveSettings({ cwd });

  return Response.json({
    ...bundle,
    profiles: DEFAULT_COMMAND_PROFILES,
    permissionModeMeta: PERMISSION_MODE_META,
    grants: listApprovalGrants(),
  });
}

/**
 * Update user or project settings.
 * Body: { layer: "user" | "project", cwd?: string, settings: Partial<SpokSettings>, reset?: boolean }
 */
export async function handleSettingsPut(req: Request) {
  const auth = authorizePrivilegedRequest(req, "settings_put");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    layer?: "user" | "project";
    cwd?: string;
    settings?: unknown;
    reset?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON body",
      code: "forbidden",
      policy: "local_capability",
      action: "settings_put",
    });
  }

  const layer = body.layer || "user";

  if (body.reset && layer === "user") {
    const resolved = resetUserSettings();
    appendAuditEvent({
      type: "settings_change",
      timestamp: Date.now(),
      action: "settings",
      policy: "user_reset",
      decision: "allowed",
      details: { layer: "user", reset: true },
    });
    return Response.json({
      ok: true,
      resolved,
      user: {},
      managed: loadManagedSettings(),
    });
  }

  const partial = sanitizePartialSettings(body.settings ?? {});

  if (layer === "project") {
    if (!body.cwd?.trim()) {
      return Response.json(
        { error: "cwd required for project settings" },
        { status: 400 }
      );
    }
    saveProjectSettings(body.cwd, partial);
  } else {
    saveUserSettings(partial);
  }

  appendAuditEvent({
    type: "settings_change",
    timestamp: Date.now(),
    action: "settings",
    cwd: body.cwd,
    policy: `layer:${layer}`,
    decision: "allowed",
    details: { layer, keys: Object.keys(partial) },
  });

  const bundle = resolveSettings({ cwd: body.cwd });
  return Response.json({
    ok: true,
    ...bundle,
    user: loadUserSettings(),
    project: loadProjectSettings(body.cwd),
    managed: loadManagedSettings(),
    resolved: getResolvedSettings(body.cwd),
  });
}
