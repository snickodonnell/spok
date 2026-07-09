/**
 * Browser-safe format helpers for skills/agents (no Node fs).
 */

import type { CustomAgentConfig, SkillDescriptor } from "./types";

/**
 * Build a compact skill attachment for a prompt turn.
 * Prefer short index lines over full bodies so we do not bloat every prompt.
 */
export function buildSkillAttachmentSnippet(
  skills: SkillDescriptor[],
  opts?: { excerpts?: Record<string, string> }
): string {
  if (!skills.length) return "";
  const lines: string[] = [
    "## Attached Spok skills",
    "Use these skills when relevant. Full skill files live on disk — do not restate them wholesale.",
    "",
  ];
  for (const s of skills) {
    lines.push(`- **${s.name}** (\`${s.id}\`)`);
    lines.push(`  ${s.description}`);
    lines.push(`  Path: ${s.path}`);
    const excerpt = opts?.excerpts?.[s.id];
    if (excerpt) {
      lines.push("  Excerpt:");
      lines.push(
        excerpt
          .split("\n")
          .slice(0, 40)
          .map((l) => `  > ${l}`)
          .join("\n")
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Build a short agent brief for the next prompt turn (opt-in only).
 * Does not dump systemPrompt unless includeSystemPrompt is true.
 */
export function buildAgentBrief(
  agent: CustomAgentConfig,
  opts?: { includeSystemPrompt?: boolean }
): string {
  const lines = [
    `## Agent: ${agent.name}`,
    agent.description || "",
    agent.permissionMode ? `Permission mode: ${agent.permissionMode}` : "",
    agent.worktreeIsolation ? "Isolation: worktree" : "",
    agent.tools?.length ? `Tools: ${agent.tools.join(", ")}` : "",
    agent.skills?.length ? `Skills: ${agent.skills.join(", ")}` : "",
    agent.model ? `Model: ${agent.model}` : "",
  ].filter(Boolean);

  if (opts?.includeSystemPrompt && agent.systemPrompt?.trim()) {
    lines.push("", "### Role instructions", agent.systemPrompt.trim());
  }
  return lines.join("\n");
}
