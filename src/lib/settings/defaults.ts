import type { CommandProfile, SpokSettings } from "./types";

export const DEFAULT_COMMAND_PROFILES: CommandProfile[] = [
  {
    id: "grok",
    name: "Grok CLI",
    description: "Official Grok Build agent CLI (default harness command).",
    binaries: ["grok", "grok.cmd", "grok.exe"],
    risk: "medium",
    requiresApprovalInManual: false,
    allowedInPlan: false,
  },
  {
    id: "git",
    name: "Git",
    description: "Git status, diff, and read-only inspection (write ops still gated).",
    binaries: ["git", "git.exe"],
    risk: "low",
    requiresApprovalInManual: false,
    allowedInPlan: true,
  },
  {
    id: "package",
    name: "Package managers",
    description: "npm, pnpm, yarn, bun — install and script runners.",
    binaries: ["npm", "npm.cmd", "pnpm", "pnpm.cmd", "yarn", "yarn.cmd", "bun", "bun.exe"],
    risk: "high",
    requiresApprovalInManual: true,
    allowedInPlan: false,
  },
  {
    id: "test",
    name: "Test runners",
    description: "Common unit/e2e test binaries.",
    binaries: [
      "node",
      "node.exe",
      "tsx",
      "tsx.cmd",
      "vitest",
      "vitest.cmd",
      "jest",
      "jest.cmd",
      "pytest",
      "pytest.exe",
      "cargo",
      "cargo.exe",
      "go",
      "go.exe",
    ],
    risk: "medium",
    requiresApprovalInManual: true,
    allowedInPlan: false,
  },
  {
    id: "custom",
    name: "Custom / unknown",
    description: "Any binary not matching a known profile.",
    binaries: ["*"],
    risk: "critical",
    requiresApprovalInManual: true,
    allowedInPlan: false,
  },
];

export function defaultSettings(): SpokSettings {
  return {
    version: 1,
    permissionMode: "manual",
    rules: [
      {
        id: "deny-shell-interpreters",
        label: "Deny raw shells",
        effect: "deny",
        actions: ["spawn"],
        command: "{cmd,cmd.exe,powershell,powershell.exe,pwsh,pwsh.exe,bash,sh,zsh}",
        reason: "Shell interpreters must not be spawned directly by the harness.",
        enabled: true,
      },
      {
        id: "allow-grok-spawn",
        label: "Allow Grok CLI",
        effect: "allow",
        actions: ["spawn"],
        profile: "grok",
        reason: "Default agent binary.",
        enabled: true,
      },
      {
        id: "allow-git-read",
        label: "Allow git",
        effect: "allow",
        actions: ["git", "spawn"],
        profile: "git",
        reason: "Git bridge and status/diff.",
        enabled: true,
      },
    ],
    autoProfiles: ["grok", "git"],
    allowCustomCommands: false,
    browseRestrictedToTrusted: false, // picker must explore until trust; then UI can tighten
    showHiddenFolders: false,
    auditPrivilegedActions: true,
    maxRestoredSessions: 20,
    ui: {
      // Professional is the daily-driver default (Phase 6); CRT remains one click away.
      theme: "professional",
      crtEnabled: false,
      scanlines: false,
      reducedMotion: false,
      osNotifications: true,
      contextLimitTokens: 128_000,
      showUsageMeter: true,
    },
    desktop: {
      nativeFolderPicker: true,
      osNotifications: true,
    },
  };
}

export const PERMISSION_MODE_META: Record<
  SpokSettings["permissionMode"],
  { label: string; description: string; risk: string }
> = {
  manual: {
    label: "Manual",
    description:
      "Safest daily default. Grok may run; custom commands and high-risk profiles need approval.",
    risk: "low",
  },
  plan: {
    label: "Plan / read-only",
    description:
      "No agent spawn. Git read and browse only. Use when reviewing without running tools.",
    risk: "lowest",
  },
  acceptEdits: {
    label: "Accept edits",
    description:
      "Grok can run and edit within the trusted workspace. Custom binaries still need approval.",
    risk: "medium",
  },
  auto: {
    label: "Auto (allowlisted)",
    description:
      "Auto-approve profiles listed under Auto profiles. Deny rules still win. Custom stays gated.",
    risk: "medium-high",
  },
  bypass: {
    label: "Bypass (dangerous)",
    description:
      "Allow all commands inside trusted roots except explicit deny rules. Only for disposable envs.",
    risk: "critical",
  },
};
