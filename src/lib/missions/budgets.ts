/**
 * Budget receipts and parent/child inheritance for Mission v1.
 * Children inherit no more than mission/work-item caps.
 */

import type {
  BudgetDimension,
  BudgetLimits,
  BudgetReceipt,
  Mission,
  WorkItem,
} from "./types";

export type BudgetCheckResult =
  | { ok: true; receipt: BudgetReceipt }
  | {
      ok: false;
      code: "budget_exhausted" | "budget_over_parent";
      error: string;
      receipt?: BudgetReceipt;
      dimension?: BudgetDimension;
    };

function nonNegInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/** Normalize unknown input into BudgetLimits (drops invalid dims). */
export function sanitizeBudgetLimits(input: unknown): BudgetLimits {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const o = input as Record<string, unknown>;
  const limits: BudgetLimits = {};
  const timeMs = nonNegInt(o.timeMs);
  const tokens = nonNegInt(o.tokens);
  const toolCalls = nonNegInt(o.toolCalls);
  const retries = nonNegInt(o.retries);
  if (timeMs !== undefined) limits.timeMs = timeMs;
  if (tokens !== undefined) limits.tokens = tokens;
  if (toolCalls !== undefined) limits.toolCalls = toolCalls;
  if (retries !== undefined) limits.retries = retries;
  return limits;
}

function dimValue(limits: BudgetLimits, dim: BudgetDimension): number | undefined {
  switch (dim) {
    case "time":
      return limits.timeMs;
    case "tokens":
      return limits.tokens;
    case "tools":
      return limits.toolCalls;
    case "retries":
      return limits.retries;
  }
}

function setDim(limits: BudgetLimits, dim: BudgetDimension, value: number): BudgetLimits {
  switch (dim) {
    case "time":
      return { ...limits, timeMs: value };
    case "tokens":
      return { ...limits, tokens: value };
    case "tools":
      return { ...limits, toolCalls: value };
    case "retries":
      return { ...limits, retries: value };
  }
}

const DIMS: BudgetDimension[] = ["time", "tokens", "tools", "retries"];

/**
 * Child limits must not exceed parent on any dimension the parent caps.
 * Uncapped parent dimensions remain open for the child (caller may still set a cap).
 */
export function childWithinParent(
  parent: BudgetLimits,
  child: BudgetLimits
): { ok: true } | { ok: false; dimension: BudgetDimension; error: string } {
  for (const dim of DIMS) {
    const p = dimValue(parent, dim);
    const c = dimValue(child, dim);
    if (p !== undefined && c !== undefined && c > p) {
      return {
        ok: false,
        dimension: dim,
        error: `Child ${dim} budget ${c} exceeds parent cap ${p}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Build a budget receipt from granted + consumed.
 * Marks exhausted dimensions when consumed >= granted (and granted is set).
 */
export function buildBudgetReceipt(
  granted: BudgetLimits,
  consumed: BudgetLimits,
  at = Date.now()
): BudgetReceipt {
  const remaining: BudgetLimits = {};
  const exhausted: BudgetDimension[] = [];

  for (const dim of DIMS) {
    const g = dimValue(granted, dim);
    const c = dimValue(consumed, dim) ?? 0;
    if (g === undefined) continue;
    const left = Math.max(0, g - c);
    Object.assign(remaining, setDim(remaining, dim, left));
    if (c >= g) exhausted.push(dim);
  }

  return {
    version: 1,
    granted: { ...granted },
    consumed: { ...consumed },
    remaining,
    exhausted,
    at,
  };
}

/** Apply consumption and refuse when a dimension would exceed the grant. */
export function applyBudgetConsumption(
  granted: BudgetLimits,
  priorConsumed: BudgetLimits,
  delta: BudgetLimits,
  at = Date.now()
): BudgetCheckResult {
  const next: BudgetLimits = { ...priorConsumed };
  for (const dim of DIMS) {
    const d = dimValue(delta, dim);
    if (d === undefined || d === 0) continue;
    const prior = dimValue(priorConsumed, dim) ?? 0;
    const g = dimValue(granted, dim);
    const sum = prior + d;
    if (g !== undefined && sum > g) {
      const receipt = buildBudgetReceipt(granted, priorConsumed, at);
      return {
        ok: false,
        code: "budget_exhausted",
        error: `Budget exhausted on ${dim}: consumed ${prior}, delta ${d}, grant ${g}`,
        receipt: {
          ...receipt,
          exhausted: Array.from(new Set([...receipt.exhausted, dim])),
        },
        dimension: dim,
      };
    }
    Object.assign(next, setDim(next, dim, sum));
  }
  return { ok: true, receipt: buildBudgetReceipt(granted, next, at) };
}

/**
 * Ensure work-item budgets and requested retries do not exceed mission caps.
 * Also refuses when retries.used > retries.max.
 */
export function assertWorkItemBudgetWithinMission(
  mission: Pick<Mission, "budgets">,
  workItem: Pick<WorkItem, "budgets" | "retries" | "id">
): BudgetCheckResult {
  const inherit = childWithinParent(mission.budgets, workItem.budgets);
  if (!inherit.ok) {
    return {
      ok: false,
      code: "budget_over_parent",
      error: `Work item ${workItem.id}: ${inherit.error}`,
      dimension: inherit.dimension,
    };
  }

  const missionRetries = mission.budgets.retries;
  if (
    missionRetries !== undefined &&
    workItem.retries.max > missionRetries
  ) {
    return {
      ok: false,
      code: "budget_over_parent",
      error: `Work item ${workItem.id}: retry max ${workItem.retries.max} exceeds mission cap ${missionRetries}`,
      dimension: "retries",
    };
  }

  if (workItem.retries.used > workItem.retries.max) {
    const receipt = buildBudgetReceipt(
      { retries: workItem.retries.max },
      { retries: workItem.retries.used }
    );
    return {
      ok: false,
      code: "budget_exhausted",
      error: `Work item ${workItem.id}: retries exhausted (${workItem.retries.used}/${workItem.retries.max})`,
      receipt,
      dimension: "retries",
    };
  }

  return {
    ok: true,
    receipt: buildBudgetReceipt(workItem.budgets, {
      retries: workItem.retries.used,
    }),
  };
}
