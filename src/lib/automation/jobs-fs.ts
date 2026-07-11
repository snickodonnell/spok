import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { ensureSpokHome, getSpokHome } from "@/lib/spok-paths";
import { canonicalizePath } from "@/lib/security/paths";
import { redactSecrets } from "@/lib/security/secrets";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import {
  AUTOMATION_DEFAULTS,
  type AutomationJob,
  type AutomationJobOutcome,
  type JobKind,
  type QueueItemStatus,
} from "./types";

export const AUTOMATION_JOBS_SCHEMA_VERSION = 1 as const;

type JobsFileV1 = {
  version: typeof AUTOMATION_JOBS_SCHEMA_VERSION;
  updatedAt: number;
  jobs: AutomationJob[];
};

export type JobSanitizeResult =
  | { ok: true; job: AutomationJob; redactions: number }
  | { ok: false; code: string; error: string };

export type JobLedgerLoadResult = {
  jobs: AutomationJob[];
  reconciled: number;
  discarded: number;
  corrupt: boolean;
};

const KINDS = new Set<JobKind>([
  "background",
  "scheduled",
  "channel",
  "compare",
]);
const STATUSES = new Set<QueueItemStatus>([
  "queued",
  "starting",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
const ACTIVE_STATUSES = new Set<QueueItemStatus>([
  "queued",
  "starting",
  "running",
  "waiting_approval",
]);
const IN_FLIGHT_STATUSES = new Set<QueueItemStatus>([
  "starting",
  "running",
  "waiting_approval",
]);
const OUTCOMES = new Set<AutomationJobOutcome["kind"]>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
  "interrupted",
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteTime(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function optionalSafeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return SAFE_ID.test(trimmed) ? trimmed : undefined;
}

function redactAndLimit(value: unknown, max: number): { text?: string; count: number } {
  if (typeof value !== "string") return { count: 0 };
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return { count: 0 };
  const redacted = redactSecrets(trimmed);
  return { text: redacted.text, count: redacted.count };
}

function absolutePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value.trim())) {
    return undefined;
  }
  return canonicalizePath(value.trim());
}

function sanitizeOutcome(value: unknown): AutomationJobOutcome | undefined {
  if (!isObject(value) || !OUTCOMES.has(value.kind as AutomationJobOutcome["kind"])) {
    return undefined;
  }
  const at = finiteTime(value.at);
  if (at === undefined) return undefined;
  const summary = redactAndLimit(value.summary, 2_000).text;
  const reason = redactAndLimit(value.reason, 2_000).text;
  const exitCode =
    value.exitCode === null
      ? null
      : typeof value.exitCode === "number" && Number.isInteger(value.exitCode)
        ? Math.max(-1, Math.min(255, value.exitCode))
        : undefined;
  return {
    kind: value.kind as AutomationJobOutcome["kind"],
    at,
    exitCode,
    summary,
    reason,
  };
}

/**
 * Convert an untrusted job payload into the exact durable shape.
 * Unknown fields (notably env maps and credentials) are never retained.
 */
export function sanitizeAutomationJob(input: unknown): JobSanitizeResult {
  if (!isObject(input)) {
    return { ok: false, code: "invalid_job", error: "Job must be an object" };
  }
  const id = optionalSafeId(input.id);
  if (!id) return { ok: false, code: "invalid_id", error: "Invalid job id" };
  if (!KINDS.has(input.kind as JobKind)) {
    return { ok: false, code: "invalid_kind", error: "Invalid job kind" };
  }
  if (!STATUSES.has(input.status as QueueItemStatus)) {
    return { ok: false, code: "invalid_status", error: "Invalid job status" };
  }

  const title = redactAndLimit(input.title, 200);
  const prompt = redactAndLimit(input.prompt, 100_000);
  const cwd = absolutePath(input.cwd);
  const createdAt = finiteTime(input.createdAt);
  if (!title.text || !prompt.text || !cwd || createdAt === undefined) {
    return {
      ok: false,
      code: "invalid_required_fields",
      error: "Job requires title, prompt, absolute cwd, and createdAt",
    };
  }

  const status = input.status as QueueItemStatus;
  if (ACTIVE_STATUSES.has(status) && prompt.count > 0) {
    return {
      ok: false,
      code: "sensitive_prompt",
      error: "Active automation prompts containing detected secrets cannot be persisted",
    };
  }

  const isolate = input.isolate !== false;
  const worktreePath =
    input.worktreePath === undefined ? undefined : absolutePath(input.worktreePath);
  const mainCheckout =
    input.mainCheckout === undefined ? undefined : absolutePath(input.mainCheckout);
  if (input.worktreePath !== undefined && !worktreePath) {
    return { ok: false, code: "invalid_worktree", error: "Invalid worktree path" };
  }
  if (input.mainCheckout !== undefined && !mainCheckout) {
    return { ok: false, code: "invalid_checkout", error: "Invalid main checkout path" };
  }
  if (worktreePath && !mainCheckout) {
    return {
      ok: false,
      code: "missing_checkout_link",
      error: "A durable worktree must link to its main checkout",
    };
  }

  const error = redactAndLimit(input.error, 4_000);
  const summary = redactAndLimit(input.summary, 4_000);
  const branch = redactAndLimit(input.branch, 256);
  const policyProfile =
    isObject(input.policy) && typeof input.policy.profile === "string"
      ? redactAndLimit(input.policy.profile, 128).text
      : optionalSafeId(input.agentId);
  const finishedAt = finiteTime(input.finishedAt);
  const updatedAt = finiteTime(input.updatedAt) ?? createdAt;
  const providedOutcome = sanitizeOutcome(input.outcome);
  const outcome = ACTIVE_STATUSES.has(status)
    ? undefined
    : providedOutcome ?? {
        kind: status as AutomationJobOutcome["kind"],
        at: finishedAt ?? updatedAt,
        exitCode:
          input.exitCode === null
            ? null
            : typeof input.exitCode === "number" &&
                Number.isInteger(input.exitCode)
              ? Math.max(-1, Math.min(255, input.exitCode))
              : undefined,
        summary: summary.text,
        reason: error.text,
      };
  const priority =
    typeof input.priority === "number" && Number.isFinite(input.priority)
      ? Math.max(-100, Math.min(100, Math.trunc(input.priority)))
      : 0;
  const exitCode =
    input.exitCode === null
      ? null
      : typeof input.exitCode === "number" && Number.isInteger(input.exitCode)
        ? Math.max(-1, Math.min(255, input.exitCode))
        : undefined;

  return {
    ok: true,
    redactions:
      title.count +
      prompt.count +
      error.count +
      summary.count +
      branch.count,
    job: {
      id,
      kind: input.kind as JobKind,
      title: title.text,
      prompt: prompt.text,
      cwd,
      isolate,
      worktreePath,
      branch: branch.text,
      mainCheckout,
      status,
      priority,
      createdAt,
      updatedAt,
      preparingAt: finiteTime(input.preparingAt),
      startedAt: finiteTime(input.startedAt),
      finishedAt,
      sessionId: optionalSafeId(input.sessionId),
      parentSessionId: optionalSafeId(input.parentSessionId),
      scheduleId: optionalSafeId(input.scheduleId),
      channelId: optionalSafeId(input.channelId),
      error: error.text,
      exitCode,
      agentId: optionalSafeId(input.agentId),
      summary: summary.text,
      policy: {
        requireTrusted: true,
        isolate,
        profile: policyProfile,
      },
      outcome,
    },
  };
}

export function getAutomationJobsFilePath(): string {
  return path.join(getSpokHome(), "automation-jobs.json");
}

function capJobs(jobs: AutomationJob[]): AutomationJob[] {
  const unique: AutomationJob[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    unique.push(job);
  }
  const active = unique.filter((job) => ACTIVE_STATUSES.has(job.status));
  const terminal = unique
    .filter((job) => !ACTIVE_STATUSES.has(job.status))
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.updatedAt ?? b.createdAt) -
        (a.finishedAt ?? a.updatedAt ?? a.createdAt)
    );
  return [...active, ...terminal].slice(0, AUTOMATION_DEFAULTS.maxQueueHistory);
}

function atomicWriteJobs(jobs: AutomationJob[]): void {
  ensureSpokHome();
  const file = getAutomationJobsFilePath();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const payload: JobsFileV1 = {
    version: AUTOMATION_JOBS_SCHEMA_VERSION,
    updatedAt: Date.now(),
    jobs: capJobs(jobs),
  };
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      // POSIX and current Node/Windows normally replace the destination here.
      renameSync(tmp, file);
    } catch (replaceError) {
      if (!existsSync(file)) throw replaceError;

      // Some Windows filesystems reject rename-over-existing. Move the prior
      // complete ledger aside first, then restore it if promotion fails.
      const backup = `${file}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.bak`;
      renameSync(file, backup);
      try {
        renameSync(tmp, file);
      } catch (promotionError) {
        try {
          renameSync(backup, file);
        } catch {
          // Best effort: backup remains a complete prior ledger for recovery.
        }
        throw promotionError;
      }
      try {
        unlinkSync(backup);
      } catch {
        // A stale backup is safer than risking the promoted ledger.
      }
    }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

export function reconcileAutomationJobs(
  jobs: AutomationJob[],
  now = Date.now()
): { jobs: AutomationJob[]; reconciled: number } {
  let reconciled = 0;
  const next = jobs.map((job) => {
    if (IN_FLIGHT_STATUSES.has(job.status)) {
      reconciled += 1;
      const reason = "Interrupted when Spok restarted; no live process was reattached";
      return {
        ...job,
        status: "failed" as const,
        updatedAt: now,
        finishedAt: now,
        error: reason,
        summary: "Interrupted by app restart",
        outcome: {
          kind: "interrupted" as const,
          at: now,
          reason,
          summary: "Interrupted by app restart",
        },
      };
    }
    if (job.status === "queued") {
      const trust = requireTrustedCwd(job.cwd);
      if (!trust.ok) {
        reconciled += 1;
        const reason =
          "Queued job was not resumed because its workspace is no longer trusted";
        return {
          ...job,
          status: "failed" as const,
          updatedAt: now,
          finishedAt: now,
          error: reason,
          summary: "Blocked during restart recovery",
          outcome: {
            kind: "failed" as const,
            at: now,
            reason,
            summary: "Blocked during restart recovery",
          },
        };
      }
    }
    return job;
  });
  return { jobs: next, reconciled };
}

export function loadAutomationJobLedger(opts?: {
  reconcile?: boolean;
  now?: number;
}): JobLedgerLoadResult {
  const file = getAutomationJobsFilePath();
  if (!existsSync(file)) {
    return { jobs: [], reconciled: 0, discarded: 0, corrupt: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { jobs: [], reconciled: 0, discarded: 0, corrupt: true };
  }
  if (
    !isObject(parsed) ||
    parsed.version !== AUTOMATION_JOBS_SCHEMA_VERSION ||
    !Array.isArray(parsed.jobs)
  ) {
    return { jobs: [], reconciled: 0, discarded: 0, corrupt: true };
  }

  const jobs: AutomationJob[] = [];
  let discarded = 0;
  for (const input of parsed.jobs) {
    const sanitized = sanitizeAutomationJob(input);
    if (!sanitized.ok) {
      discarded += 1;
      continue;
    }
    jobs.push(sanitized.job);
  }
  const capped = capJobs(jobs);
  discarded += Math.max(0, jobs.length - capped.length);
  const recovery = opts?.reconcile
    ? reconcileAutomationJobs(capped, opts.now)
    : { jobs: capped, reconciled: 0 };
  if (opts?.reconcile && (recovery.reconciled > 0 || discarded > 0)) {
    atomicWriteJobs(recovery.jobs);
  }
  return {
    jobs: recovery.jobs,
    reconciled: recovery.reconciled,
    discarded,
    corrupt: false,
  };
}

function requireActiveJobTrust(job: AutomationJob): string | null {
  if (!ACTIVE_STATUSES.has(job.status)) return null;
  const trust = requireTrustedCwd(job.cwd);
  return trust.ok ? null : trust.reason;
}

export function replaceAutomationJobs(
  input: unknown
): { ok: true; jobs: AutomationJob[] } | { ok: false; code: string; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, code: "invalid_jobs", error: "jobs must be an array" };
  }
  const jobs: AutomationJob[] = [];
  for (const value of input) {
    const sanitized = sanitizeAutomationJob(value);
    if (!sanitized.ok) return sanitized;
    const trustError = requireActiveJobTrust(sanitized.job);
    if (trustError) {
      return { ok: false, code: "untrusted_cwd", error: trustError };
    }
    jobs.push(sanitized.job);
  }
  const capped = capJobs(jobs);
  atomicWriteJobs(capped);
  return { ok: true, jobs: capped };
}

export function upsertAutomationJob(
  input: unknown
): { ok: true; job: AutomationJob; jobs: AutomationJob[] } | {
  ok: false;
  code: string;
  error: string;
} {
  const sanitized = sanitizeAutomationJob(input);
  if (!sanitized.ok) return sanitized;
  const trustError = requireActiveJobTrust(sanitized.job);
  if (trustError) {
    return { ok: false, code: "untrusted_cwd", error: trustError };
  }
  const loaded = loadAutomationJobLedger();
  const jobs = capJobs([
    sanitized.job,
    ...loaded.jobs.filter((job) => job.id !== sanitized.job.id),
  ]);
  atomicWriteJobs(jobs);
  return { ok: true, job: sanitized.job, jobs };
}
