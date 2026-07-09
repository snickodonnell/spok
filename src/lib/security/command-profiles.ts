import { DEFAULT_COMMAND_PROFILES } from "@/lib/settings/defaults";
import type { CommandProfile, CommandProfileId, RiskLevel } from "@/lib/settings/types";

export function listCommandProfiles(): CommandProfile[] {
  return DEFAULT_COMMAND_PROFILES;
}

function basename(command: string): string {
  const norm = command.replace(/\\/g, "/");
  return (norm.split("/").pop() || command).toLowerCase();
}

/** Match a command path/name to a profile (custom if none). */
export function resolveCommandProfile(command: string): CommandProfile {
  const base = basename(command);
  for (const profile of DEFAULT_COMMAND_PROFILES) {
    if (profile.id === "custom") continue;
    for (const b of profile.binaries) {
      if (b === "*") continue;
      if (base === b.toLowerCase()) return profile;
      // allow grok.exe style already in list
    }
  }
  return (
    DEFAULT_COMMAND_PROFILES.find((p) => p.id === "custom") ?? {
      id: "custom",
      name: "Custom",
      description: "Unknown binary",
      binaries: ["*"],
      risk: "critical" as RiskLevel,
      requiresApprovalInManual: true,
      allowedInPlan: false,
    }
  );
}

export function isProfileId(id: string): id is CommandProfileId {
  return ["grok", "git", "package", "test", "custom"].includes(id);
}

/**
 * Simple command matcher supporting exact basename, comma/{a,b} sets, and * wildcards.
 */
export function matchCommandPattern(command: string, pattern: string): boolean {
  const base = basename(command);
  const raw = pattern.trim().toLowerCase();
  if (!raw) return false;

  // Brace set: {cmd,powershell}
  const brace = raw.match(/^\{([^}]+)\}$/);
  if (brace) {
    return brace[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((p) => matchCommandPattern(command, p));
  }

  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((p) => matchCommandPattern(command, p));
  }

  if (raw === "*" || raw === "**") return true;

  // Glob: * and ?
  const escaped = raw
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(base);
}

export function formatCommandPreview(
  command: string,
  args: string[] = []
): string {
  const parts = [command, ...args.map(quote)];
  return parts.join(" ");
}

function quote(s: string): string {
  if (!/[\s"']/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
