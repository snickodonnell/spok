/**
 * Diagnostics bundle builder (Phase 6).
 * Collects redacted environment + settings + session health for support/export.
 */

import os from "os";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { getSpokHome, getSessionsRoot } from "./spok-paths";
import { resolveSettings } from "./settings/settings-fs";
import { vaultDiagnostics } from "./security/secrets-vault";
import { listTrustedRoots } from "./security/workspace-trust";
import { getLocalCapabilityToken } from "./security/local-api";

export type DiagnosticsBundle = {
  version: 1;
  generatedAt: string;
  app: {
    name: string;
    version: string;
    node: string;
    platform: string;
    arch: string;
    release: string;
    cpus: number;
    totalMemMb: number;
    freeMemMb: number;
    uptimeSec: number;
  };
  paths: {
    spokHome: string;
    sessionsRoot: string;
    settingsUser: string;
    auditLog: string;
    workspaceTrust: string;
  };
  sessions: {
    count: number;
    dirs: string[];
  };
  settings: {
    permissionMode: string;
    allowCustomCommands: boolean;
    browseRestrictedToTrusted: boolean;
    auditPrivilegedActions: boolean;
    theme: string;
    reducedMotion: boolean;
    osNotifications: boolean;
    nativeFolderPicker: boolean;
    ruleCount: number;
    autoProfiles: string[];
  };
  security: {
    trustedRootCount: number;
    capabilityTokenPresent: boolean;
    vault: ReturnType<typeof vaultDiagnostics>;
  };
  env: {
    SPOK_HOME: boolean;
    SPOK_SESSIONS_DIR: boolean;
    SPOK_GROK_CMD: boolean;
    SPOK_ALLOW_CUSTOM_COMMANDS: boolean;
    SPOK_PERMISSION_MODE: boolean;
    NODE_ENV: string | undefined;
  };
  checks: DiagnosticsCheck[];
};

export type DiagnosticsCheck = {
  id: string;
  ok: boolean;
  message: string;
  severity: "info" | "warn" | "error";
};

function listSessionDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => {
      try {
        return statSync(path.join(root, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function buildDiagnosticsBundle(opts?: {
  cwd?: string;
}): DiagnosticsBundle {
  const home = getSpokHome();
  const sessionsRoot = getSessionsRoot();
  const sessionDirs = listSessionDirs(sessionsRoot);
  const layered = resolveSettings({ cwd: opts?.cwd });
  const resolved = layered.resolved;
  const vault = vaultDiagnostics();
  let trustedCount = 0;
  try {
    trustedCount = listTrustedRoots().length;
  } catch {
    trustedCount = 0;
  }

  let tokenPresent = false;
  try {
    tokenPresent = !!getLocalCapabilityToken();
  } catch {
    tokenPresent = false;
  }

  const checks: DiagnosticsCheck[] = [];

  checks.push({
    id: "spok_home",
    ok: existsSync(home),
    message: existsSync(home)
      ? `Spok home exists at ${home}`
      : `Spok home missing at ${home}`,
    severity: existsSync(home) ? "info" : "warn",
  });

  checks.push({
    id: "sessions",
    ok: true,
    message: `${sessionDirs.length} durable session director${sessionDirs.length === 1 ? "y" : "ies"}`,
    severity: "info",
  });

  checks.push({
    id: "permission_mode",
    ok: resolved.permissionMode !== "bypass",
    message:
      resolved.permissionMode === "bypass"
        ? "Permission mode is bypass — only for disposable environments"
        : `Permission mode: ${resolved.permissionMode}`,
    severity: resolved.permissionMode === "bypass" ? "warn" : "info",
  });

  checks.push({
    id: "custom_commands",
    ok: !resolved.allowCustomCommands,
    message: resolved.allowCustomCommands
      ? "Custom commands allowed without profile (higher risk)"
      : "Custom commands require approval",
    severity: resolved.allowCustomCommands ? "warn" : "info",
  });

  checks.push({
    id: "audit",
    ok: resolved.auditPrivilegedActions,
    message: resolved.auditPrivilegedActions
      ? "Privileged action audit is enabled"
      : "Privileged action audit is disabled",
    severity: resolved.auditPrivilegedActions ? "info" : "warn",
  });

  checks.push({
    id: "vault",
    ok: true,
    message: vault.hasKey
      ? `Secrets vault ready (${vault.secretCount} secret${vault.secretCount === 1 ? "" : "s"})`
      : "Secrets vault has no key yet (created on first write)",
    severity: "info",
  });

  checks.push({
    id: "capability_token",
    ok: tokenPresent,
    message: tokenPresent
      ? "Local capability token is available"
      : "Capability token missing",
    severity: tokenPresent ? "info" : "error",
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    app: {
      name: "spok",
      version: "0.1.0",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpus: os.cpus().length,
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
      uptimeSec: Math.round(os.uptime()),
    },
    paths: {
      spokHome: home,
      sessionsRoot,
      settingsUser: path.join(home, "settings.json"),
      auditLog: path.join(home, "audit.ndjson"),
      workspaceTrust: path.join(home, "workspace-trust.json"),
    },
    sessions: {
      count: sessionDirs.length,
      // Cap paths for export size; ids only
      dirs: sessionDirs.slice(0, 50),
    },
    settings: {
      permissionMode: resolved.permissionMode,
      allowCustomCommands: resolved.allowCustomCommands,
      browseRestrictedToTrusted: resolved.browseRestrictedToTrusted,
      auditPrivilegedActions: resolved.auditPrivilegedActions,
      theme: resolved.ui.theme,
      reducedMotion: resolved.ui.reducedMotion,
      osNotifications: resolved.ui.osNotifications ?? resolved.desktop.osNotifications,
      nativeFolderPicker: resolved.desktop.nativeFolderPicker,
      ruleCount: resolved.rules.filter((r) => r.enabled !== false).length,
      autoProfiles: [...resolved.autoProfiles],
    },
    security: {
      trustedRootCount: trustedCount,
      capabilityTokenPresent: tokenPresent,
      vault,
    },
    env: {
      SPOK_HOME: !!process.env.SPOK_HOME,
      SPOK_SESSIONS_DIR: !!process.env.SPOK_SESSIONS_DIR,
      SPOK_GROK_CMD: !!process.env.SPOK_GROK_CMD,
      SPOK_ALLOW_CUSTOM_COMMANDS: !!process.env.SPOK_ALLOW_CUSTOM_COMMANDS,
      SPOK_PERMISSION_MODE: !!process.env.SPOK_PERMISSION_MODE,
      NODE_ENV: process.env.NODE_ENV,
    },
    checks,
  };
}

export function summarizeDiagnostics(bundle: DiagnosticsBundle): {
  ok: number;
  warn: number;
  error: number;
  headline: string;
} {
  const ok = bundle.checks.filter((c) => c.severity === "info" && c.ok).length;
  const warn = bundle.checks.filter((c) => c.severity === "warn").length;
  const error = bundle.checks.filter(
    (c) => c.severity === "error" || (c.severity === "info" && !c.ok)
  ).length;
  const headline =
    error > 0
      ? `${error} diagnostic error${error === 1 ? "" : "s"}`
      : warn > 0
        ? `${warn} warning${warn === 1 ? "" : "s"} — review recommended`
        : "All diagnostics healthy";
  return { ok, warn, error, headline };
}
