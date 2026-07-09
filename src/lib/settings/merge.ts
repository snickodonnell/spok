import { defaultSettings } from "./defaults";
import { isUiTheme } from "../theme";
import type {
  LayeredSettingsBundle,
  PermissionRule,
  SettingsLayer,
  SpokSettings,
} from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-merge plain objects; arrays are replaced (not concatenated) unless handled specially. */
export function deepMergeSettings(
  base: SpokSettings,
  overlay: Partial<SpokSettings>
): SpokSettings {
  const out: SpokSettings = {
    ...base,
    ...overlay,
    ui: { ...base.ui, ...(overlay.ui ?? {}) },
    desktop: { ...base.desktop, ...(overlay.desktop ?? {}) },
    rules: overlay.rules ?? base.rules,
    autoProfiles: overlay.autoProfiles ?? base.autoProfiles,
  };
  return out;
}

/**
 * Merge layered settings. Rules are concatenated so higher layers can add
 * deny/allow entries; later layers' scalar fields override earlier ones.
 */
export function mergeLayeredSettings(layers: {
  managed?: Partial<SpokSettings>;
  user?: Partial<SpokSettings>;
  project?: Partial<SpokSettings>;
  local?: Partial<SpokSettings>;
}): LayeredSettingsBundle {
  const managed = layers.managed ?? {};
  const user = layers.user ?? {};
  const project = layers.project ?? {};
  const local = layers.local ?? {};

  let resolved = defaultSettings();
  const provenance: LayeredSettingsBundle["provenance"] = {};

  const apply = (partial: Partial<SpokSettings>, layer: SettingsLayer) => {
    if (!partial || Object.keys(partial).length === 0) return;

    // Concatenate rules: base defaults + each layer (enabled filter later)
    if (partial.rules) {
      resolved = {
        ...resolved,
        rules: mergeRules(resolved.rules, partial.rules),
      };
      provenance.rules = layer;
    }

    if (partial.permissionMode !== undefined) {
      resolved.permissionMode = partial.permissionMode;
      provenance.permissionMode = layer;
    }
    if (partial.autoProfiles !== undefined) {
      resolved.autoProfiles = partial.autoProfiles;
      provenance.autoProfiles = layer;
    }
    if (partial.allowCustomCommands !== undefined) {
      resolved.allowCustomCommands = partial.allowCustomCommands;
      provenance.allowCustomCommands = layer;
    }
    if (partial.browseRestrictedToTrusted !== undefined) {
      resolved.browseRestrictedToTrusted = partial.browseRestrictedToTrusted;
      provenance.browseRestrictedToTrusted = layer;
    }
    if (partial.showHiddenFolders !== undefined) {
      resolved.showHiddenFolders = partial.showHiddenFolders;
      provenance.showHiddenFolders = layer;
    }
    if (partial.auditPrivilegedActions !== undefined) {
      resolved.auditPrivilegedActions = partial.auditPrivilegedActions;
      provenance.auditPrivilegedActions = layer;
    }
    if (partial.maxRestoredSessions !== undefined) {
      resolved.maxRestoredSessions = partial.maxRestoredSessions;
      provenance.maxRestoredSessions = layer;
    }
    if (partial.version !== undefined) {
      resolved.version = partial.version;
      provenance.version = layer;
    }
    if (partial.ui) {
      resolved = { ...resolved, ui: { ...resolved.ui, ...partial.ui } };
      provenance.ui = layer;
    }
    if (partial.desktop) {
      resolved = {
        ...resolved,
        desktop: { ...resolved.desktop, ...partial.desktop },
      };
      provenance.desktop = layer;
    }
  };

  // Defaults have no provenance; managed → user → project → local
  apply(managed, "managed");
  apply(user, "user");
  apply(project, "project");
  apply(local, "local");

  // Ensure version
  resolved.version = 1;

  return {
    managed,
    user,
    project,
    local,
    resolved,
    provenance,
  };
}

/** Later rules append; same id is replaced by the later definition. */
export function mergeRules(
  base: PermissionRule[],
  overlay: PermissionRule[]
): PermissionRule[] {
  const map = new Map<string, PermissionRule>();
  for (const r of base) map.set(r.id, r);
  for (const r of overlay) map.set(r.id, r);
  return [...map.values()];
}

export function sanitizePartialSettings(
  input: unknown
): Partial<SpokSettings> {
  if (!isObject(input)) return {};
  const out: Partial<SpokSettings> = {};
  const d = defaultSettings();

  if (input.version === 1) out.version = 1;
  if (
    typeof input.permissionMode === "string" &&
    ["manual", "plan", "acceptEdits", "auto", "bypass"].includes(
      input.permissionMode
    )
  ) {
    out.permissionMode = input.permissionMode as SpokSettings["permissionMode"];
  }
  if (Array.isArray(input.rules)) {
    out.rules = input.rules
      .filter((r): r is PermissionRule => isObject(r) && typeof r.id === "string")
      .map((r) => ({
        id: String(r.id),
        label: typeof r.label === "string" ? r.label : undefined,
        effect:
          r.effect === "allow" || r.effect === "deny" || r.effect === "ask"
            ? r.effect
            : "ask",
        actions: Array.isArray(r.actions)
          ? (r.actions.filter((a) => typeof a === "string") as PermissionRule["actions"])
          : ["spawn"],
        command: typeof r.command === "string" ? r.command : undefined,
        path: typeof r.path === "string" ? r.path : undefined,
        profile: typeof r.profile === "string" ? r.profile : undefined,
        reason: typeof r.reason === "string" ? r.reason : undefined,
        enabled: r.enabled !== false,
      }));
  }
  if (Array.isArray(input.autoProfiles)) {
    out.autoProfiles = input.autoProfiles.filter(
      (p): p is string => typeof p === "string"
    );
  }
  if (typeof input.allowCustomCommands === "boolean") {
    out.allowCustomCommands = input.allowCustomCommands;
  }
  if (typeof input.browseRestrictedToTrusted === "boolean") {
    out.browseRestrictedToTrusted = input.browseRestrictedToTrusted;
  }
  if (typeof input.showHiddenFolders === "boolean") {
    out.showHiddenFolders = input.showHiddenFolders;
  }
  if (typeof input.auditPrivilegedActions === "boolean") {
    out.auditPrivilegedActions = input.auditPrivilegedActions;
  }
  if (
    typeof input.maxRestoredSessions === "number" &&
    Number.isFinite(input.maxRestoredSessions)
  ) {
    out.maxRestoredSessions = Math.max(
      1,
      Math.min(100, Math.floor(input.maxRestoredSessions))
    );
  }
  if (isObject(input.ui)) {
    const theme = isUiTheme(input.ui.theme)
      ? input.ui.theme
      : // Back-compat: older settings without theme → infer from crtEnabled
        typeof input.ui.crtEnabled === "boolean" && input.ui.crtEnabled
        ? "crt"
        : d.ui.theme;
    out.ui = {
      theme,
      crtEnabled:
        typeof input.ui.crtEnabled === "boolean"
          ? input.ui.crtEnabled
          : theme === "crt",
      scanlines:
        typeof input.ui.scanlines === "boolean"
          ? input.ui.scanlines
          : theme === "crt",
      reducedMotion:
        typeof input.ui.reducedMotion === "boolean"
          ? input.ui.reducedMotion
          : d.ui.reducedMotion,
      osNotifications:
        typeof input.ui.osNotifications === "boolean"
          ? input.ui.osNotifications
          : d.ui.osNotifications,
      contextLimitTokens:
        typeof input.ui.contextLimitTokens === "number" &&
        Number.isFinite(input.ui.contextLimitTokens)
          ? Math.max(
              1_000,
              Math.min(2_000_000, Math.floor(input.ui.contextLimitTokens))
            )
          : d.ui.contextLimitTokens,
      showUsageMeter:
        typeof input.ui.showUsageMeter === "boolean"
          ? input.ui.showUsageMeter
          : d.ui.showUsageMeter,
    };
  }
  if (isObject(input.desktop)) {
    out.desktop = {
      nativeFolderPicker:
        typeof input.desktop.nativeFolderPicker === "boolean"
          ? input.desktop.nativeFolderPicker
          : d.desktop.nativeFolderPicker,
      osNotifications:
        typeof input.desktop.osNotifications === "boolean"
          ? input.desktop.osNotifications
          : d.desktop.osNotifications,
    };
  }

  return out;
}
