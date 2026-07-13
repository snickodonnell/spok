/**
 * Gate slash-command permission flag mutations at the apply site
 * (UX-009). High-risk escalations require confirm-before-mutation;
 * de-escalation is immediate. Does not rewrite grok-commands resolveRun.
 */

import type { GrokRunFlags } from "@/lib/grok-commands";
import {
  currentProviderSelection,
  flagsForProviderSelection,
  isProviderPermissionSelection,
  requiresEscalationConfirmation,
  type ProviderPermissionSelection,
} from "@/lib/security/effective-policy";

export type PermissionFlagPatch = {
  alwaysApprove?: boolean;
  permissionMode?: string;
};

/** True when a set-flag patch touches provider permission sticky flags. */
export function patchTouchesProviderPermission(
  patch: Record<string, unknown>
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(patch, "alwaysApprove") ||
    Object.prototype.hasOwnProperty.call(patch, "permissionMode")
  );
}

/**
 * Intended provider selection for a permission-related slash/UI patch.
 *
 * - `/always-approve` on → always-approve
 * - `/always-approve` off → sticky permissionMode or manual
 * - `/permission-mode X` → X (clears always-approve on apply, matching select)
 *
 * Returns null when the patch is not a known permission intent (caller may
 * passthrough raw flags for unknown modes).
 */
export function targetSelectionFromPermissionPatch(
  current: { alwaysApprove?: boolean; permissionMode?: string },
  patch: PermissionFlagPatch
): ProviderPermissionSelection | null {
  const hasAlwaysApprove = Object.prototype.hasOwnProperty.call(
    patch,
    "alwaysApprove"
  );
  if (hasAlwaysApprove && patch.alwaysApprove === true) {
    return "always-approve";
  }
  if (hasAlwaysApprove && patch.permissionMode === undefined) {
    // alwaysApprove explicitly off (or non-true) → de-escalate
    const mode = current.permissionMode;
    if (
      mode &&
      isProviderPermissionSelection(mode) &&
      mode !== "always-approve"
    ) {
      return mode;
    }
    return "manual";
  }
  if (patch.permissionMode !== undefined) {
    const mode = String(patch.permissionMode).trim();
    if (!mode) return null;
    if (isProviderPermissionSelection(mode)) return mode;
    return null;
  }
  return null;
}

export type SlashPermissionGateResult =
  | { kind: "passthrough" }
  | {
      kind: "apply";
      selection: ProviderPermissionSelection;
      flags: Pick<GrokRunFlags, "alwaysApprove" | "permissionMode">;
    }
  | {
      kind: "confirm";
      selection: ProviderPermissionSelection;
      flags: Pick<GrokRunFlags, "alwaysApprove" | "permissionMode">;
    };

/**
 * Decide whether a set-flag patch may mutate immediately, needs confirmation,
 * or should pass through as non-permission flags.
 */
export function gateProviderPermissionPatch(
  currentFlags: { alwaysApprove?: boolean; permissionMode?: string },
  patch: Record<string, unknown>
): SlashPermissionGateResult {
  if (!patchTouchesProviderPermission(patch)) {
    return { kind: "passthrough" };
  }

  const permPatch: PermissionFlagPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "alwaysApprove")) {
    permPatch.alwaysApprove = patch.alwaysApprove === true;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "permissionMode")) {
    permPatch.permissionMode =
      typeof patch.permissionMode === "string"
        ? patch.permissionMode
        : undefined;
  }

  const from = currentProviderSelection(currentFlags);
  const to = targetSelectionFromPermissionPatch(currentFlags, permPatch);
  if (!to) {
    // Unknown permissionMode string — do not invent elevation; passthrough.
    return { kind: "passthrough" };
  }

  const flags = flagsForProviderSelection(to);
  if (requiresEscalationConfirmation(from, to)) {
    return { kind: "confirm", selection: to, flags };
  }
  return { kind: "apply", selection: to, flags };
}
