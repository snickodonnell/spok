/**
 * Product-level workspace modes (UI/UX Harness Plan Horizon 1).
 * Run is the default daily loop; Review / Automate / Extend are progressive power surfaces.
 */

export type ProductMode = "run" | "review" | "automate" | "extend";

/** Right pane task tabs inside the Run workspace. */
export type WorkspaceRightTab =
  | "changes"
  | "review"
  | "validation"
  | "events"
  | "health";

/** Left pane: readable Thinking feed vs full event graph. */
export type LeftTraceMode = "thinking" | "events";

export const PRODUCT_MODE_META: Record<
  ProductMode,
  { label: string; short: string; description: string }
> = {
  run: {
    label: "Run",
    short: "Run",
    description: "Prompt, think, watch changes",
  },
  review: {
    label: "Review",
    short: "Review",
    description: "Stage, commit, branch, PR",
  },
  automate: {
    label: "Automate",
    short: "Automate",
    description: "Queue, schedules, lanes",
  },
  extend: {
    label: "Extend",
    short: "Extend",
    description: "Skills, MCP, hooks, agents",
  },
};

export const RIGHT_TAB_META: Record<
  WorkspaceRightTab,
  { label: string; description: string }
> = {
  changes: {
    label: "Changes",
    description: "File tree, diffs, stage, causal links",
  },
  review: {
    label: "Review",
    description: "Commit, branch, push, PR, worktrees",
  },
  validation: {
    label: "Validation",
    description: "Tools, tests, builds, approvals, failures",
  },
  events: {
    label: "Events",
    description: "Raw stream log and system messages",
  },
  health: {
    label: "Health",
    description: "Metrics, usage, session overview",
  },
};

/** Map product mode → default right tab when entering workspace. */
export function defaultRightTabForMode(mode: ProductMode): WorkspaceRightTab {
  if (mode === "review") return "review";
  return "changes";
}

export function isProductMode(v: unknown): v is ProductMode {
  return v === "run" || v === "review" || v === "automate" || v === "extend";
}

export function isWorkspaceRightTab(v: unknown): v is WorkspaceRightTab {
  return (
    v === "changes" ||
    v === "review" ||
    v === "validation" ||
    v === "events" ||
    v === "health"
  );
}
