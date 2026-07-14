/** Durable mission/work-item delegation receipts compiled under Spok authority. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { z } from "zod";
import { canonicalizePath, isPathInsideRoot } from "@/lib/security/paths";
import { redactSecrets } from "@/lib/security/secrets";
import { getMissionDir } from "./persist";
import type { Mission, WorkItemStatus } from "./types";
import { MISSION_SAFE_ID } from "./types";

export const MISSION_RECEIPT_VERSION = 1 as const;
export const MIN_INTEGRATION_RESERVE_RATIO = 0.2;

const id = z.string().trim().refine((value) => MISSION_SAFE_ID.test(value), "invalid id");
const text = (max: number) => z.string().trim().min(1).max(max);
const stringList = (maxItems: number, maxLength: number) =>
  z.array(text(maxLength)).max(maxItems);
const absolutePath = z
  .string()
  .trim()
  .refine((value) => path.isAbsolute(value), "must be absolute");
const relativeScope = text(512)
  .refine((value) => !path.isAbsolute(value), "must be repository-relative")
  .refine(
    (value) => !value.replace(/\\/g, "/").split("/").includes(".."),
    "must not traverse outside the repository"
  );

const sessionIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("new"), sessionId: z.string().uuid() }).strict(),
  z.object({ intent: z.literal("resume"), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      intent: z.literal("fork"),
      sourceSessionId: z.string().uuid(),
      newSessionId: z.string().uuid(),
    })
    .strict(),
]);

const workItemDraftSchema = z
  .object({
    workItemId: id,
    integrationOwner: id,
    priority: z.number().int().min(-100).max(100).default(0),
    scope: z
      .object({ own: z.array(relativeScope).min(1).max(64), exclude: z.array(relativeScope).max(64) })
      .strict(),
    execution: z
      .object({
        cwd: absolutePath,
        baseRevision: text(128),
        isolation: z.literal("verified"),
        session: sessionIntentSchema,
        allowSubagents: z.literal(false),
      })
      .strict(),
    authority: z
      .object({
        permission: text(128),
        tools: stringList(64, 128),
        destructive: z.literal(false),
      })
      .strict(),
    budget: z
      .object({
        maxTurns: z.number().int().min(1).max(100),
        tokens: z.number().int().positive(),
        retry: z.number().int().min(0).max(1),
      })
      .strict(),
    context: stringList(128, 512),
    definitionOfDone: stringList(64, 1_000).min(1),
    checks: stringList(32, 1_000),
    returnWhen: z.enum(["complete", "blocked", "authority_needed", "budget_pressure"]),
  })
  .strict();

export const missionReceiptDraftSchema = z
  .object({
    id,
    repositoryBase: text(128),
    integrationOwner: id,
    validation: stringList(64, 1_000),
    nextCheckpoint: text(512),
    budget: z
      .object({
        totalTokens: z.number().int().positive(),
        integrationReserveTokens: z.number().int().positive(),
        recoveryReserveTokens: z.number().int().positive(),
      })
      .strict(),
    workItems: z.array(workItemDraftSchema).min(1).max(256),
  })
  .strict();

export type MissionReceiptDraft = z.infer<typeof missionReceiptDraftSchema>;

export type MissionReceipt = {
  version: typeof MISSION_RECEIPT_VERSION;
  id: string;
  missionId: string;
  outcome: string;
  definitionOfDone: string[];
  constraints: string[];
  repository: { root: string; base: string };
  policy: { ref: string; destructive: false };
  budget: {
    totalTokens: number;
    integrationReserveTokens: number;
    recoveryReserveTokens: number;
    executionTokens: number;
  };
  validation: string[];
  integrationOwner: string;
  nextCheckpoint: string;
  compiledAt: number;
};

export type WorkItemReceipt = {
  version: typeof MISSION_RECEIPT_VERSION;
  missionId: string;
  workItemId: string;
  milestoneId?: string;
  outcome: string;
  owner: string;
  integrationOwner: string;
  priority: number;
  dependsOn: string[];
  status: WorkItemStatus;
  scope: { own: string[]; exclude: string[] };
  execution: {
    cwd: string;
    baseRevision: string;
    isolation: "verified";
    session: z.infer<typeof sessionIntentSchema>;
    allowSubagents: false;
  };
  authority: { permission: string; tools: string[]; destructive: false };
  budget: { maxTurns: number; tokens: number; retry: number };
  context: string[];
  definitionOfDone: string[];
  checks: string[];
  expectedEvidence: string[];
  returnWhen: "complete" | "blocked" | "authority_needed" | "budget_pressure";
  reportSchema: "specialist-v1";
};

export type MissionReceiptBundle = {
  version: typeof MISSION_RECEIPT_VERSION;
  mission: MissionReceipt;
  workItems: WorkItemReceipt[];
};

const missionReceiptPersistedSchema = z
  .object({
    version: z.literal(MISSION_RECEIPT_VERSION),
    id,
    missionId: id,
    outcome: text(4_000),
    definitionOfDone: stringList(64, 1_000),
    constraints: stringList(64, 1_000),
    repository: z.object({ root: absolutePath, base: text(128) }).strict(),
    policy: z.object({ ref: text(256), destructive: z.literal(false) }).strict(),
    budget: z
      .object({
        totalTokens: z.number().int().positive(),
        integrationReserveTokens: z.number().int().positive(),
        recoveryReserveTokens: z.number().int().positive(),
        executionTokens: z.number().int().positive(),
      })
      .strict(),
    validation: stringList(64, 1_000),
    integrationOwner: id,
    nextCheckpoint: text(512),
    compiledAt: z.number().int().nonnegative(),
  })
  .strict();

const workItemReceiptPersistedSchema = z
  .object({
    version: z.literal(MISSION_RECEIPT_VERSION),
    missionId: id,
    workItemId: id,
    milestoneId: id.optional(),
    outcome: text(4_000),
    owner: id,
    integrationOwner: id,
    priority: z.number().int().min(-100).max(100),
    dependsOn: z.array(id).max(256),
    status: z.enum(["pending", "ready", "active", "blocked", "completed", "failed", "cancelled"]),
    scope: z
      .object({
        own: z.array(relativeScope).min(1).max(64),
        exclude: z.array(relativeScope).max(64),
      })
      .strict(),
    execution: z
      .object({
        cwd: absolutePath,
        baseRevision: text(128),
        isolation: z.literal("verified"),
        session: sessionIntentSchema,
        allowSubagents: z.literal(false),
      })
      .strict(),
    authority: z
      .object({
        permission: text(128),
        tools: stringList(64, 128),
        destructive: z.literal(false),
      })
      .strict(),
    budget: z
      .object({
        maxTurns: z.number().int().min(1).max(100),
        tokens: z.number().int().positive(),
        retry: z.number().int().min(0).max(1),
      })
      .strict(),
    context: stringList(128, 512),
    definitionOfDone: stringList(64, 1_000).min(1),
    checks: stringList(32, 1_000),
    expectedEvidence: stringList(64, 1_000),
    returnWhen: z.enum(["complete", "blocked", "authority_needed", "budget_pressure"]),
    reportSchema: z.literal("specialist-v1"),
  })
  .strict();

const missionReceiptBundlePersistedSchema = z
  .object({
    version: z.literal(MISSION_RECEIPT_VERSION),
    mission: missionReceiptPersistedSchema,
    workItems: z.array(workItemReceiptPersistedSchema).min(1).max(256),
  })
  .strict();

export class MissionReceiptError extends Error {
  readonly code: "invalid_receipt" | "authority_over_request" | "budget_over_parent" | "isolation";
  readonly issues: readonly { path: string; message: string }[];

  constructor(
    code: MissionReceiptError["code"],
    message: string,
    issues: readonly { path: string; message: string }[] = []
  ) {
    super(message);
    this.name = "MissionReceiptError";
    this.code = code;
    this.issues = issues;
  }
}

export function compileMissionReceiptBundle(
  mission: Mission,
  input: unknown,
  now = Date.now()
): MissionReceiptBundle {
  const parsed = missionReceiptDraftSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 16).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new MissionReceiptError("invalid_receipt", issues[0]?.message || "Invalid receipt draft", issues);
  }
  const draft = parsed.data;
  if (draft.budget.totalTokens !== mission.budgets.tokens) {
    throw new MissionReceiptError(
      "budget_over_parent",
      "Receipt total token budget must equal the durable mission grant"
    );
  }
  if (
    draft.budget.integrationReserveTokens <
    Math.ceil(draft.budget.totalTokens * MIN_INTEGRATION_RESERVE_RATIO)
  ) {
    throw new MissionReceiptError(
      "budget_over_parent",
      `Integration reserve must be at least ${Math.round(MIN_INTEGRATION_RESERVE_RATIO * 100)}%`
    );
  }
  const executionTokens =
    draft.budget.totalTokens -
    draft.budget.integrationReserveTokens -
    draft.budget.recoveryReserveTokens;
  if (executionTokens <= 0) {
    throw new MissionReceiptError("budget_over_parent", "Reserves leave no specialist execution budget");
  }

  const workById = new Map(mission.workItems.map((workItem) => [workItem.id, workItem]));
  if (draft.workItems.length !== mission.workItems.length) {
    throw new MissionReceiptError("invalid_receipt", "Every durable work item requires exactly one receipt");
  }
  const seen = new Set<string>();
  const receipts: WorkItemReceipt[] = [];
  for (const itemDraft of draft.workItems) {
    if (seen.has(itemDraft.workItemId)) {
      throw new MissionReceiptError("invalid_receipt", `Duplicate work item receipt ${itemDraft.workItemId}`);
    }
    seen.add(itemDraft.workItemId);
    const workItem = workById.get(itemDraft.workItemId);
    if (!workItem) {
      throw new MissionReceiptError("invalid_receipt", `Unknown work item ${itemDraft.workItemId}`);
    }
    if (itemDraft.execution.baseRevision !== draft.repositoryBase) {
      throw new MissionReceiptError(
        "isolation",
        `Work item ${workItem.id} base revision must match the mission receipt base`
      );
    }
    const expectedCwd = workItem.authorityReceipt?.worktreePath || mission.worktreePath;
    if (!expectedCwd || !samePath(itemDraft.execution.cwd, expectedCwd)) {
      throw new MissionReceiptError(
        "isolation",
        `Work item ${workItem.id} requires its verified durable worktree`
      );
    }
    const cap = workItem.budgets.tokens;
    if (cap === undefined || itemDraft.budget.tokens > cap) {
      throw new MissionReceiptError(
        "budget_over_parent",
        `Work item ${workItem.id} token budget exceeds its durable grant`
      );
    }
    if (itemDraft.budget.retry > workItem.retries.max) {
      throw new MissionReceiptError(
        "budget_over_parent",
        `Work item ${workItem.id} retry budget exceeds its durable grant`
      );
    }
    const allowedCapabilities = new Set(
      workItem.authorityReceipt?.capabilities ?? mission.authority?.capabilities ?? []
    );
    if (
      allowedCapabilities.size > 0 &&
      itemDraft.authority.tools.some((tool) => !allowedCapabilities.has(tool))
    ) {
      throw new MissionReceiptError(
        "authority_over_request",
        `Work item ${workItem.id} requested a tool outside its authority receipt`
      );
    }
    const own = normalizeScopes(itemDraft.scope.own);
    const exclude = normalizeScopes(itemDraft.scope.exclude);
    if (own.some((scope) => exclude.includes(scope))) {
      throw new MissionReceiptError(
        "invalid_receipt",
        `Work item ${workItem.id} cannot own and exclude the same scope`
      );
    }
    receipts.push({
      version: 1,
      missionId: mission.id,
      workItemId: workItem.id,
      ...(workItem.milestoneId ? { milestoneId: workItem.milestoneId } : {}),
      outcome: redactSecrets(workItem.title).text,
      owner: workItem.owner,
      integrationOwner: itemDraft.integrationOwner,
      priority: itemDraft.priority,
      dependsOn: [...workItem.dependencies],
      status: workItem.status,
      scope: { own, exclude },
      execution: {
        ...itemDraft.execution,
        cwd: canonicalizePath(itemDraft.execution.cwd),
      },
      authority: itemDraft.authority,
      budget: itemDraft.budget,
      context: redactList(itemDraft.context),
      definitionOfDone: redactList(itemDraft.definitionOfDone),
      checks: redactList(itemDraft.checks),
      expectedEvidence: redactList(workItem.expectedEvidence),
      returnWhen: itemDraft.returnWhen,
      reportSchema: "specialist-v1",
    });
  }
  assertNoUnplannedOverlap(receipts);
  const grantedExecutionTokens = receipts.reduce(
    (total, receipt) => total + receipt.budget.tokens,
    0
  );
  if (grantedExecutionTokens > executionTokens) {
    throw new MissionReceiptError(
      "budget_over_parent",
      `Work-item grants ${grantedExecutionTokens} exceed execution allocation ${executionTokens}`
    );
  }

  const bundle: MissionReceiptBundle = {
    version: MISSION_RECEIPT_VERSION,
    mission: {
      version: MISSION_RECEIPT_VERSION,
      id: draft.id,
      missionId: mission.id,
      outcome: redactSecrets(mission.outcome).text,
      definitionOfDone: redactList(mission.definitionOfDone),
      constraints: redactList(mission.constraints),
      repository: { root: canonicalizePath(mission.repository), base: draft.repositoryBase },
      policy: { ref: mission.policyRef, destructive: false },
      budget: {
        ...draft.budget,
        executionTokens,
      },
      validation: redactList(draft.validation),
      integrationOwner: draft.integrationOwner,
      nextCheckpoint: redactSecrets(draft.nextCheckpoint).text,
      compiledAt: now,
    },
    workItems: receipts,
  };
  return deepFreeze(bundle);
}

export function saveMissionReceiptBundle(bundle: MissionReceiptBundle): string {
  const dir = path.join(getMissionDir(bundle.mission.missionId), "receipts");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${bundle.mission.id}.json`);
  atomicWriteJson(file, bundle);
  return file;
}

export function readMissionReceiptBundle(
  missionId: string,
  receiptId: string
): MissionReceiptBundle | null {
  if (!MISSION_SAFE_ID.test(missionId) || !MISSION_SAFE_ID.test(receiptId)) return null;
  const file = path.join(getMissionDir(missionId), "receipts", `${receiptId}.json`);
  if (!existsSync(file)) return null;
  try {
    return migrateMissionReceiptBundle(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Migrate the short-lived v0 snake-case prototype into the durable v1 envelope. */
export function migrateMissionReceiptBundle(input: unknown): MissionReceiptBundle {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MissionReceiptError("invalid_receipt", "Receipt bundle must be an object");
  }
  const value = input as Record<string, unknown>;
  const candidate =
    value.version === 0
      ? {
          version: 1,
          mission: value.mission_receipt,
          workItems: value.work_item_receipts,
        }
      : value;
  const parsed = missionReceiptBundlePersistedSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 16).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new MissionReceiptError(
      "invalid_receipt",
      issues[0]?.message || "Unsupported receipt bundle version",
      issues
    );
  }
  const bundle = parsed.data as MissionReceiptBundle;
  if (bundle.workItems.some((item) => item.missionId !== bundle.mission.missionId)) {
    throw new MissionReceiptError("invalid_receipt", "Receipt bundle identities are invalid");
  }
  const uniqueWorkItems = new Set(bundle.workItems.map((item) => item.workItemId));
  if (uniqueWorkItems.size !== bundle.workItems.length) {
    throw new MissionReceiptError("invalid_receipt", "Receipt bundle contains duplicate work items");
  }
  const budget = bundle.mission.budget;
  if (
    budget.executionTokens + budget.integrationReserveTokens + budget.recoveryReserveTokens !==
      budget.totalTokens ||
    budget.integrationReserveTokens < Math.ceil(budget.totalTokens * MIN_INTEGRATION_RESERVE_RATIO)
  ) {
    throw new MissionReceiptError("budget_over_parent", "Persisted receipt reserves are invalid");
  }
  const granted = bundle.workItems.reduce((total, item) => total + item.budget.tokens, 0);
  if (granted > budget.executionTokens) {
    throw new MissionReceiptError("budget_over_parent", "Persisted work-item grants exceed execution budget");
  }
  for (const item of bundle.workItems) {
    if (item.execution.baseRevision !== bundle.mission.repository.base) {
      throw new MissionReceiptError("isolation", `Persisted work item ${item.workItemId} has a stale base`);
    }
  }
  assertNoUnplannedOverlap(bundle.workItems);
  return deepFreeze(bundle);
}

function assertNoUnplannedOverlap(receipts: WorkItemReceipt[]): void {
  for (let left = 0; left < receipts.length; left += 1) {
    for (let right = left + 1; right < receipts.length; right += 1) {
      const a = receipts[left];
      const b = receipts[right];
      if (!a.scope.own.some((scopeA) => b.scope.own.some((scopeB) => scopesOverlap(scopeA, scopeB)))) {
        continue;
      }
      const serialized = a.dependsOn.includes(b.workItemId) || b.dependsOn.includes(a.workItemId);
      if (!serialized || a.integrationOwner !== b.integrationOwner) {
        throw new MissionReceiptError(
          "invalid_receipt",
          `Overlapping work items ${a.workItemId} and ${b.workItemId} require one integration owner and an explicit dependency`
        );
      }
    }
  }
}

function scopesOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizeScopes(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")))
  ).sort();
}

function redactList(values: string[]): string[] {
  return values.map((value) => redactSecrets(value).text);
}

function samePath(a: string, b: string): boolean {
  const left = canonicalizePath(a);
  const right = canonicalizePath(b);
  return isPathInsideRoot(left, right) && isPathInsideRoot(right, left);
}

function atomicWriteJson(file: string, value: unknown): void {
  const nonce = Math.random().toString(36).slice(2);
  const temp = `${file}.${process.pid}.${nonce}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      renameSync(temp, file);
    } catch (replaceError) {
      if (!existsSync(file)) throw replaceError;
      const backup = `${file}.${process.pid}.${nonce}.bak`;
      renameSync(file, backup);
      try {
        renameSync(temp, file);
      } catch (promotionError) {
        try {
          renameSync(backup, file);
        } catch {
          /* preserve the backup for recovery */
        }
        throw promotionError;
      }
      try {
        unlinkSync(backup);
      } catch {
        /* stale backup is safer than losing the durable receipt */
      }
    }
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      /* preserve the original error */
    }
    throw error;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
