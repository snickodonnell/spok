import path from "path";
import { z } from "zod";
import { MISSION_SAFE_ID } from "@/lib/missions/types";

export const BOUNDED_ARTIFACT_WORKFLOW_VERSION = 1 as const;
export const BOUNDED_ARTIFACT_WORKFLOW_CAPABILITY =
  "bounded_artifact_workflow_v1" as const;

const safeId = z
  .string()
  .trim()
  .refine((value) => MISSION_SAFE_ID.test(value), "invalid id");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 digest");
const absolutePath = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => path.isAbsolute(value), "must be absolute");
const relativePath = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !path.isAbsolute(value), "must be relative")
  .refine(
    (value) => !value.replace(/\\/g, "/").split("/").includes(".."),
    "must not traverse outside the output root"
  );
const archiveArtifactType = z.enum([
  "media_manifest",
  "transcript",
  "attributed_transcript",
  "transcript_attribution_manifest",
  "word_timings",
  "diarization_segments",
  "speaker_evidence_manifest",
  "scene_segments",
  "scene_detection_manifest",
  "character_screenshots",
  "character_screenshot_manifest",
  "character_appearance_observations",
  "character_visual_progression",
  "visual_observations",
  "episode_events",
  "episode_analysis",
  "lore_delta",
  "quality_report",
]);

/**
 * Machine-readable execution contract for one bounded analytical leader run.
 * It references an already-staged input packet; it never embeds media or
 * transcript content in the provider prompt.
 */
export const boundedArtifactWorkflowRequestSchema = z
  .object({
    version: z.literal(BOUNDED_ARTIFACT_WORKFLOW_VERSION),
    kind: z.literal("wallaby_archive"),
    missionId: safeId,
    workItemId: safeId,
    episodeId: safeId,
    inputPacket: z
      .object({ path: absolutePath, sha256 })
      .strict(),
    outputRoot: absolutePath,
    resultPath: relativePath,
    requiredArtifactTypes: z
      .array(archiveArtifactType)
      .min(1)
      .max(64)
      .refine((values) => new Set(values).size === values.length, "must be unique"),
    expectedIdentity: z
      .object({
        jobId: safeId,
        missionId: safeId,
        workItemId: safeId,
        sessionId: safeId,
        runId: safeId,
        capabilityFingerprint: z.string().trim().min(1).max(256),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.missionId !== value.expectedIdentity.missionId) {
      context.addIssue({
        code: "custom",
        path: ["expectedIdentity", "missionId"],
        message: "must match missionId",
      });
    }
    if (value.workItemId !== value.expectedIdentity.workItemId) {
      context.addIssue({
        code: "custom",
        path: ["expectedIdentity", "workItemId"],
        message: "must match workItemId",
      });
    }
  });

export type BoundedArtifactWorkflowRequest = z.infer<
  typeof boundedArtifactWorkflowRequestSchema
>;

export type BoundedArtifactWorkflowProgress = {
  completedShards: number;
  totalShards: number;
  verifiedArtifacts: number;
  requiredArtifacts: number;
  phase: "specialists" | "integration" | "validation" | "complete";
  checkpointAt: number;
};

export type BoundedArtifactWorkflowFinding = {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
};

export type BoundedArtifactHandoff = {
  state: "validated" | "partial" | "blocked" | "invalid";
  checkedAt: number;
  manifestPath: string;
  checkpointPath: string;
  findings: BoundedArtifactWorkflowFinding[];
  progress: BoundedArtifactWorkflowProgress;
};
