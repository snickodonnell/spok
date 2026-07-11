/**
 * Copyable review / PR summary from session + review queue.
 * Pure string builders for the Review workbench.
 */

import { buildReviewQueue, type ReviewQueue } from "./review-queue";
import { buildReviewReadiness } from "./review-readiness";
import { buildValidationLane } from "./validation-lane";
import type { Session } from "./types";

export interface ReviewSummaryOptions {
  /** Include file-by-file list (default true). */
  includeFiles?: boolean;
  /** Include validation failures (default true). */
  includeValidation?: boolean;
  /** Include readiness checklist (default true). */
  includeReadiness?: boolean;
  /** Max files listed before truncation (default 40). */
  maxFiles?: number;
}

export interface ReviewSummary {
  /** Suggested PR title (single line). */
  title: string;
  /** Markdown body suitable for PR description. */
  bodyMarkdown: string;
  /** Plain-text variant for terminals / chat. */
  bodyPlain: string;
  /** Full clipboard payload (title + body). */
  clipboard: string;
  stats: {
    files: number;
    additions: number;
    deletions: number;
    groups: number;
    issues: number;
  };
}

function branchHint(session: Session): string | null {
  return session.gitSummary?.branch ?? null;
}

function defaultTitle(session: Session, queue: ReviewQueue): string {
  const branch = branchHint(session);
  if (queue.summary.total === 0) {
    return branch ? `chore: ${branch}` : "chore: session changes";
  }

  const topGroup = queue.groups[0];
  const n = queue.summary.total;
  const focus =
    topGroup?.id === "security"
      ? "security"
      : topGroup?.id === "test"
        ? "tests"
        : topGroup?.id === "config"
          ? "config"
          : topGroup?.id === "docs"
            ? "docs"
            : "code";

  const verb =
    queue.flat.every((f) => f.status === "added")
      ? "add"
      : queue.flat.every((f) => f.status === "deleted")
        ? "remove"
        : "update";

  const name = session.name?.trim();
  if (name && name.length < 60 && !/^Session\s/i.test(name)) {
    return name;
  }

  return `${verb}(${focus}): ${n} file${n === 1 ? "" : "s"} from agent session`;
}

function fileLine(item: {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  risk: { shortLabel: string };
}): string {
  const stat =
    item.additions || item.deletions
      ? ` (+${item.additions}/−${item.deletions})`
      : "";
  return `- \`${item.path}\` · ${item.status} · ${item.risk.shortLabel}${stat}`;
}

/**
 * Build a PR-oriented review summary for the active session.
 */
export function buildReviewSummary(
  session: Session,
  opts: ReviewSummaryOptions = {}
): ReviewSummary {
  const includeFiles = opts.includeFiles !== false;
  const includeValidation = opts.includeValidation !== false;
  const includeReadiness = opts.includeReadiness !== false;
  const maxFiles = opts.maxFiles ?? 40;

  const queue = buildReviewQueue(session);
  const readiness = buildReviewReadiness(session);
  const lane = buildValidationLane(session);

  let additions = 0;
  let deletions = 0;
  for (const f of queue.flat) {
    additions += f.additions;
    deletions += f.deletions;
  }

  const title = defaultTitle(session, queue);
  const branch = branchHint(session);
  const md: string[] = [];
  const plain: string[] = [];

  md.push("## Summary");
  plain.push("Summary");
  const summaryLine =
    queue.summary.total === 0
      ? "No file changes in this session."
      : `Agent session **${session.name}** touched **${queue.summary.total}** file${queue.summary.total === 1 ? "" : "s"} (+${additions}/−${deletions}).`;
  md.push(summaryLine);
  plain.push(
    queue.summary.total === 0
      ? "No file changes in this session."
      : `Agent session ${session.name} touched ${queue.summary.total} file(s) (+${additions}/−${deletions}).`
  );

  if (branch) {
    md.push("");
    md.push(`- **Branch:** \`${branch}\``);
    plain.push(`Branch: ${branch}`);
  }
  if (session.config.cwd) {
    md.push(`- **Workspace:** \`${session.config.cwd}\``);
    plain.push(`Workspace: ${session.config.cwd}`);
  }

  if (includeFiles && queue.groups.length > 0) {
    md.push("");
    md.push("## Changes by risk");
    plain.push("");
    plain.push("Changes by risk");
    let listed = 0;
    for (const g of queue.groups) {
      md.push("");
      md.push(`### ${g.label} (${g.items.length})`);
      plain.push(`${g.label} (${g.items.length})`);
      for (const item of g.items) {
        if (listed >= maxFiles) {
          md.push(`- …and ${queue.summary.total - listed} more`);
          plain.push(`…and ${queue.summary.total - listed} more`);
          listed = queue.summary.total;
          break;
        }
        md.push(fileLine(item));
        plain.push(
          `  ${item.path} · ${item.status} · ${item.risk.shortLabel} (+${item.additions}/−${item.deletions})`
        );
        listed += 1;
      }
      if (listed >= maxFiles) break;
    }
  }

  if (includeValidation) {
    const failed = lane.items.filter(
      (i) => i.status === "failed" || i.status === "blocked"
    );
    if (failed.length > 0 || queue.issues.length > 0) {
      md.push("");
      md.push("## Open issues");
      plain.push("");
      plain.push("Open issues");
      const markers = queue.issues.slice(0, 20);
      for (const issue of markers) {
        const loc = issue.path ? ` (\`${issue.path}\`)` : "";
        md.push(`- **${issue.title}**${loc} — ${issue.detail}`);
        plain.push(`- ${issue.title}${issue.path ? ` (${issue.path})` : ""} — ${issue.detail}`);
      }
      if (queue.issues.length > 20) {
        md.push(`- …and ${queue.issues.length - 20} more markers`);
      }
    } else {
      md.push("");
      md.push("## Validation");
      md.push(`- ${lane.summary.headline}`);
      plain.push("");
      plain.push(`Validation: ${lane.summary.headline}`);
    }
  }

  if (includeReadiness) {
    md.push("");
    md.push("## Commit readiness");
    plain.push("");
    plain.push("Commit readiness");
    md.push(`- **${readiness.summary}**`);
    plain.push(readiness.summary);
    for (const item of readiness.items) {
      if (item.severity === "ok" || item.severity === "info") continue;
      md.push(`- ${item.label}: ${item.detail}`);
      plain.push(`  ${item.label}: ${item.detail}`);
    }
  }

  md.push("");
  md.push("---");
  md.push("_Generated by Spok review workbench_");

  const bodyMarkdown = md.join("\n");
  const bodyPlain = plain.join("\n");
  const clipboard = `${title}\n\n${bodyMarkdown}`;

  return {
    title,
    bodyMarkdown,
    bodyPlain,
    clipboard,
    stats: {
      files: queue.summary.total,
      additions,
      deletions,
      groups: queue.groups.length,
      issues: queue.issues.length,
    },
  };
}
