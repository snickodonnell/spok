/**
 * Layered Spok settings and permission policy types (Phase 2).
 *
 * Merge order (later overrides earlier for scalars; rules are concatenated
 * with higher-priority layers winning on conflicts):
 *   managed → user → project → local (session UI)
 */

import type { UiTheme } from "../theme";

export type SettingsLayer = "managed" | "user" | "project" | "local";

/**
 * App-level permission mode (independent of Grok CLI --permission-mode,
 * though the UI keeps them aligned when useful).
 */
export type AppPermissionMode =
  | "manual"
  | "plan"
  | "acceptEdits"
  | "auto"
  | "bypass";

export type PermissionEffect = "allow" | "deny" | "ask";

export type PermissionAction =
  | "spawn"
  | "browse"
  | "git"
  | "read-file"
  | "write-file"
  | "export"
  | "mcp"
  | "hook";

export type CommandProfileId =
  | "grok"
  | "git"
  | "package"
  | "test"
  | "custom";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PermissionRule {
  id: string;
  /** Human label shown in settings UI */
  label?: string;
  effect: PermissionEffect;
  /** Actions this rule applies to */
  actions: PermissionAction[];
  /** Match command basename / glob (spawn) */
  command?: string;
  /** Match path glob (browse/read/git) */
  path?: string;
  /** Match command profile id */
  profile?: CommandProfileId | string;
  /** Optional notes */
  reason?: string;
  enabled?: boolean;
}

export interface CommandProfile {
  id: CommandProfileId | string;
  name: string;
  description: string;
  /** Basename patterns (case-insensitive), e.g. "grok", "git", "npm" */
  binaries: string[];
  risk: RiskLevel;
  /**
   * When true, manual/acceptEdits modes require an explicit approval unless
   * a matching allow rule or grant exists.
   */
  requiresApprovalInManual: boolean;
  /** Allowed in plan/read-only mode */
  allowedInPlan: boolean;
}

export interface SpokSettings {
  version: 1;
  permissionMode: AppPermissionMode;
  rules: PermissionRule[];
  /** Profile ids that may run without prompt in `auto` mode */
  autoProfiles: string[];
  /**
   * When false, non-profile / custom binaries are denied unless an approval
   * grant or explicit allow rule exists (safer default).
   */
  allowCustomCommands: boolean;
  /** After a workspace is trusted, browse only under trusted roots */
  browseRestrictedToTrusted: boolean;
  showHiddenFolders: boolean;
  auditPrivilegedActions: boolean;
  /** Soft max concurrent durable sessions restored at boot */
  maxRestoredSessions: number;
  ui: {
    /**
     * Appearance theme. Professional is the daily-driver default;
     * CRT keeps the retro aesthetic; high-contrast maximizes legibility.
     */
    theme: UiTheme;
    /** CRT scanlines / flicker overlays (only when theme is crt). */
    crtEnabled: boolean;
    scanlines: boolean;
    /** Prefer reduced motion (disables CRT animations and framer flourishes). */
    reducedMotion: boolean;
    /** Mirror in-app notifications to the OS (desktop shell only). */
    osNotifications: boolean;
    /**
     * Context window budget for the usage meter (tokens).
     * Override with SPOK_CONTEXT_LIMIT env for managed installs.
     */
    contextLimitTokens: number;
    /** Show compact usage meter in the metrics strip. */
    showUsageMeter: boolean;
  };
  /**
   * Desktop shell preferences (ignored in pure browser mode).
   */
  desktop: {
    /** Prefer native OS folder picker when Tauri is available. */
    nativeFolderPicker: boolean;
    /** Show OS notifications for completion / failure / approval. */
    osNotifications: boolean;
  };
}

export interface LayeredSettingsBundle {
  managed: Partial<SpokSettings>;
  user: Partial<SpokSettings>;
  project: Partial<SpokSettings>;
  local: Partial<SpokSettings>;
  resolved: SpokSettings;
  /** Which layer last wrote each top-level key (for UI) */
  provenance: Partial<Record<keyof SpokSettings, SettingsLayer>>;
}

export type ApprovalDecision = "allow_once" | "allow_always" | "deny";

export interface ApprovalRequest {
  id: string;
  timestamp: number;
  action: PermissionAction;
  sessionId?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  profile?: string;
  risk: RiskLevel;
  reason: string;
  policy: string;
  /** Human-readable preview */
  preview: string;
}

export interface ApprovalGrant {
  id: string;
  /** Fingerprint of the approved action */
  fingerprint: string;
  decision: Exclude<ApprovalDecision, "deny">;
  createdAt: number;
  /** For allow_always scoped to a workspace root */
  cwd?: string;
  command?: string;
  profile?: string;
  action: PermissionAction;
  expiresAt?: number;
}

export type AuditEventType =
  | "approval_request"
  | "approval_decision"
  | "policy_denial"
  | "runtime_action"
  | "redaction"
  | "settings_change";

export interface AuditEvent {
  type: AuditEventType;
  timestamp: number;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  action: PermissionAction | string;
  cwd?: string;
  paths?: string[];
  command?: string;
  args?: string[];
  profile?: string;
  policy?: string;
  decision?: ApprovalDecision | "blocked" | "allowed";
  risk?: RiskLevel;
  details?: Record<string, unknown>;
  redactions?: { categories: string[]; count: number };
}
