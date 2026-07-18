/** Privileged-runtime input used to create a managed prompt artifact + GrokRunSpec. */

import path from "path";
import { z } from "zod";
import { MISSION_SAFE_ID } from "@/lib/missions/types";
import { MAX_GROK_PROMPT_ARTIFACT_BYTES } from "./grok-prompt-artifacts";
import {
  boundedArtifactWorkflowRequestSchema,
  type BoundedArtifactWorkflowRequest,
} from "./bounded-artifact-workflow-contract";

export const GROK_RUN_REQUEST_VERSION = 1 as const;

const safeToken = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/@+\-]+$/);
const absolutePath = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value), "must be an absolute path");
const id = z.string().trim().refine((value) => MISSION_SAFE_ID.test(value), "invalid id");
const tokens = z.array(safeToken).max(64).refine((values) => new Set(values).size === values.length);

export const grokRunRequestSchema = z
  .object({
    version: z.literal(GROK_RUN_REQUEST_VERSION),
    id,
    cwd: absolutePath,
    command: z.string().trim().min(1).max(4096).default("grok"),
    role: z.enum(["interactive", "leaf", "leader"]),
    unattended: z.boolean(),
    workspace: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("existing"),
          path: absolutePath,
          isolation: z.enum(["verified", "not_required"]),
          branch: z.string().trim().min(1).max(512).optional(),
          baseRevision: z.string().trim().min(1).max(128).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("native_create"),
          sourcePath: absolutePath,
          name: id,
          ref: z.string().trim().min(1).max(512).optional(),
        })
        .strict(),
    ]),
    prompt: z
      .object({
        text: z.string().min(1).max(MAX_GROK_PROMPT_ARTIFACT_BYTES),
        attachmentIds: z.array(id).max(8).default([]),
      })
      .strict(),
    session: z.discriminatedUnion("intent", [
      z.object({ intent: z.literal("new"), sessionId: z.string().uuid().optional() }).strict(),
      z.object({ intent: z.literal("resume"), sessionId: z.string().uuid() }).strict(),
      z
        .object({
          intent: z.literal("fork"),
          sourceSessionId: z.string().uuid(),
          newSessionId: z.string().uuid().optional(),
        })
        .strict(),
      z.object({ intent: z.literal("continue_latest") }).strict(),
    ]),
    execution: z
      .object({
        model: safeToken.optional(),
        agent: safeToken.optional(),
        reasoningEffort: safeToken,
        maxTurns: z.number().int().min(1).max(100),
        tools: z.object({ allow: tokens, deny: tokens }).strict(),
        webSearch: z.enum(["enabled", "disabled"]),
        alwaysApprove: z.boolean(),
        permissionMode: safeToken.optional(),
        sandbox: safeToken.optional(),
        noMemory: z.boolean(),
        noPlan: z.boolean(),
        check: z.boolean(),
        delegation: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("deny") }).strict(),
          z.object({ mode: z.literal("allow"), budgetRef: id }).strict(),
        ]),
        leaderSocket: absolutePath.optional(),
      })
      .strict(),
    output: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("stream") }).strict(),
      z.object({ mode: z.literal("report"), schema: z.literal("specialist") }).strict(),
    ]),
    workflow: boundedArtifactWorkflowRequestSchema.optional(),
    debug: z.object({ retention: z.enum(["none", "failure", "handoff"]) }).strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.workflow) return;
    if (request.role !== "leader") {
      context.addIssue({
        code: "custom",
        path: ["role"],
        message: "bounded artifact workflows require one leader run",
      });
    }
    if (request.output.mode !== "report") {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "bounded artifact workflows require a compact report turn",
      });
    }
    if (request.session.intent === "continue_latest" || request.session.intent === "fork") {
      context.addIssue({
        code: "custom",
        path: ["session"],
        message: "bounded artifact workflows require an exact new or resume session",
      });
    }
    if (
      (request.session.intent === "new" || request.session.intent === "resume") &&
      request.session.sessionId !== request.workflow.expectedIdentity.sessionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["workflow", "expectedIdentity", "sessionId"],
        message: "must match the exact provider session",
      });
    }
    if (request.id !== request.workflow.expectedIdentity.runId) {
      context.addIssue({
        code: "custom",
        path: ["workflow", "expectedIdentity", "runId"],
        message: "must match the managed run id",
      });
    }
  });

export type GrokRunRequest = z.infer<typeof grokRunRequestSchema>;
export type { BoundedArtifactWorkflowRequest };

export class GrokRunRequestError extends Error {
  readonly issues: readonly { path: string; message: string }[];

  constructor(issues: readonly { path: string; message: string }[]) {
    super(issues[0]?.message || "Invalid managed Grok run request");
    this.name = "GrokRunRequestError";
    this.issues = issues;
  }
}

export function parseGrokRunRequest(input: unknown): GrokRunRequest {
  const parsed = grokRunRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new GrokRunRequestError(
      parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }
  return parsed.data;
}
