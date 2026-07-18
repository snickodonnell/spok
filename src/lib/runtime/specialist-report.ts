/** Typed, compact specialist return contract for JSON-only Grok report turns. */

import { z } from "zod";
import { redactSecrets } from "@/lib/security/secrets";
import type { StreamEvent } from "@/lib/types";

export const SPECIALIST_REPORT_VERSION = 1 as const;
export const MAX_SPECIALIST_REPORT_WORDS = 600;

const repoPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\0"), "must not contain NUL")
  .refine((value) => !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value), "must be repository-relative")
  .refine(
    (value) => !value.replace(/\\/g, "/").split("/").includes(".."),
    "must not traverse outside the repository"
  );

export const specialistReportSchema = z
  .object({
    version: z.literal(SPECIALIST_REPORT_VERSION),
    outcome: z.enum(["completed", "partial", "blocked", "failed"]),
    summary: z.string().trim().min(1).max(8_000),
    changed_paths: z.array(repoPathSchema).max(128),
    checks: z
      .array(
        z
          .object({
            command: z.string().trim().min(1).max(1_000),
            result: z.enum(["passed", "failed", "not_run"]),
            evidence: z.string().trim().max(1_000).optional(),
          })
          .strict()
      )
      .max(64),
    artifacts: z.array(z.string().trim().min(1).max(1_000)).max(64),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(64),
    next_action: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((report, ctx) => {
    const words = report.summary.split(/\s+/).filter(Boolean).length;
    if (words > MAX_SPECIALIST_REPORT_WORDS) {
      ctx.addIssue({
        code: "custom",
        path: ["summary"],
        message: `must not exceed ${MAX_SPECIALIST_REPORT_WORDS} words`,
      });
    }
    if (report.outcome === "completed" && report.risks.some((risk) => /\bblocked\b/i.test(risk))) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "completed outcome contradicts a blocked risk",
      });
    }
  });

export type SpecialistReport = z.infer<typeof specialistReportSchema>;

export const SPECIALIST_REPORT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "outcome",
    "summary",
    "changed_paths",
    "checks",
    "artifacts",
    "risks",
    "next_action",
  ],
  properties: {
    version: { const: SPECIALIST_REPORT_VERSION },
    outcome: { enum: ["completed", "partial", "blocked", "failed"] },
    summary: { type: "string", minLength: 1, maxLength: 8000 },
    changed_paths: {
      type: "array",
      maxItems: 128,
      items: { type: "string", minLength: 1, maxLength: 512 },
    },
    checks: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["command", "result"],
        properties: {
          command: { type: "string", minLength: 1, maxLength: 1000 },
          result: { enum: ["passed", "failed", "not_run"] },
          evidence: { type: "string", maxLength: 1000 },
        },
      },
    },
    artifacts: {
      type: "array",
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    risks: {
      type: "array",
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    next_action: { type: "string", minLength: 1, maxLength: 1000 },
  },
});

export const SPECIALIST_REPORT_JSON_SCHEMA_TEXT = JSON.stringify(
  SPECIALIST_REPORT_JSON_SCHEMA
);

export type SpecialistReportParseResult =
  | { ok: true; report: SpecialistReport; completeness: "complete" | "partial" }
  | {
      ok: false;
      category: "malformed_report";
      errors: Array<{ path: string; message: string }>;
      repair: {
        prompt: string;
        maxTurns: 1;
        includeRepositoryContext: false;
      };
    };

export type SpecialistReportTerminalState =
  | "completed"
  | "partial"
  | "blocked"
  | "failed"
  | "malformed";

/** Process exit alone never turns a report-mode run into task completion. */
export function classifySpecialistReportTerminalState(
  exitCode: number | null,
  result: SpecialistReportParseResult | undefined
): SpecialistReportTerminalState {
  if (exitCode !== 0) return "failed";
  if (!result || !result.ok) return "malformed";
  return result.report.outcome;
}

export function parseSpecialistReport(input: unknown): SpecialistReportParseResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input.trim());
    } catch {
      return malformed([{ path: "", message: "Report is not valid JSON" }]);
    }
  }
  const parsed = specialistReportSchema.safeParse(value);
  if (!parsed.success) {
    return malformed(
      parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }
  const report = redactReport(parsed.data);
  return {
    ok: true,
    report: Object.freeze(report),
    completeness: report.outcome === "completed" ? "complete" : "partial",
  };
}

export function specialistReportToEvent(input: {
  result: SpecialistReportParseResult;
  timestamp?: number;
  runId?: string;
  turnId?: string;
  workItemId?: string;
  agentRunId?: string;
}): StreamEvent {
  const base = {
    timestamp: input.timestamp ?? Date.now(),
    provider: "spok" as const,
    runId: input.runId,
    turnId: input.turnId,
  };
  if (!input.result.ok) {
    return {
      ...base,
      type: "parser_error",
      title: "Specialist report needs format repair",
      content: input.result.errors.map((error) => `${error.path || "report"}: ${error.message}`).join("\n"),
      status: "error",
      severity: "parser",
      meta: {
        category: input.result.category,
        repair: input.result.repair,
        workItemId: input.workItemId,
        agentRunId: input.agentRunId,
      },
    };
  }
  return {
    ...base,
    type: "agent_report",
    title: `Specialist report · ${input.result.report.outcome}`,
    content: input.result.report.summary,
    summary: input.result.report.next_action,
    status:
      input.result.report.outcome === "completed"
        ? "success"
        : input.result.report.outcome === "partial"
          ? "pending"
          : "error",
    severity:
      input.result.report.outcome === "failed" || input.result.report.outcome === "blocked"
        ? "error"
        : input.result.report.outcome === "partial"
          ? "warn"
          : "info",
    meta: {
      reportVersion: SPECIALIST_REPORT_VERSION,
      report: input.result.report,
      completeness: input.result.completeness,
      workItemId: input.workItemId,
      agentRunId: input.agentRunId,
      evidenceOnly: true,
    },
  };
}

function malformed(
  errors: Array<{ path: string; message: string }>
): SpecialistReportParseResult {
  const fields = errors.map((error) => error.path || "report").join(", ");
  return {
    ok: false,
    category: "malformed_report",
    errors,
    repair: {
      prompt: `Return only one JSON object matching the specialist report schema. Repair these fields: ${fields}. Do not repeat repository context or implementation work.`,
      maxTurns: 1,
      includeRepositoryContext: false,
    },
  };
}

function redactReport(report: SpecialistReport): SpecialistReport {
  const redact = (value: string) => redactSecrets(value).text;
  return {
    ...report,
    summary: redact(report.summary),
    changed_paths: report.changed_paths.map((value) => value.replace(/\\/g, "/")),
    checks: report.checks.map((check) => ({
      ...check,
      command: redact(check.command),
      evidence: check.evidence ? redact(check.evidence) : undefined,
    })),
    artifacts: report.artifacts.map(redact),
    risks: report.risks.map(redact),
    next_action: redact(report.next_action),
  };
}
