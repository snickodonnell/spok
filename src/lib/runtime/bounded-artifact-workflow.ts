/**
 * Durable, packet-first execution support for long analytical missions.
 *
 * The runtime reads only the explicitly named packet and files. It never walks
 * the workspace or media tree. Provider turns remain responsible for every
 * interpretation; this module records/validates execution evidence only.
 */

import { createHash } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { z } from "zod";
import { getMissionDir, readMission } from "@/lib/missions";
import { isPathInsideRoot } from "@/lib/security/paths";
import {
  boundedArtifactWorkflowRequestSchema,
  type BoundedArtifactHandoff,
  type BoundedArtifactWorkflowFinding,
  type BoundedArtifactWorkflowProgress,
  type BoundedArtifactWorkflowRequest,
} from "./bounded-artifact-workflow-contract";

const MAX_PACKET_BYTES = 512 * 1024;
const MAX_SHARD_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_JSON_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_FINDINGS = 64;
const CHECKPOINT_VERSION = 1 as const;

const relativePacketPath = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => !path.isAbsolute(value), "must be relative")
  .refine(
    (value) => !value.replace(/\\/g, "/").split("/").includes(".."),
    "must not traverse"
  );

const packetSha = z.string().regex(/^[a-f0-9]{64}$/i);
const packetFile = z
  .object({
    transcriptPath: relativePacketPath,
    sha256: packetSha,
    lineCount: z.number().int().nonnegative(),
  })
  .passthrough();

const inputPacketSchema = z
  .object({
    version: z.literal(1),
    episodeId: z.string().trim().min(1).max(128),
    immutableAsr: packetFile.nullable().optional(),
    validatedPriorTranscript: packetFile.optional(),
    temporalShards: z
      .array(
        z
          .object({
            shardId: z.string().trim().min(1).max(128),
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().nonnegative(),
            transcriptPath: relativePacketPath,
            transcriptLines: z.number().int().nonnegative(),
            visualObservationPath: relativePacketPath.optional(),
          })
          .strict()
      )
      .max(16),
    reusableMediaManifestPath: relativePacketPath.optional(),
    reusableSpeakerEvidence: z
      .object({
        manifestPath: relativePacketPath,
        validationPath: relativePacketPath,
        transcriptPath: relativePacketPath,
        wordTimingsPath: relativePacketPath,
        diarizationSegmentsPath: relativePacketPath,
        manifestSha256: packetSha,
        validationSha256: packetSha,
      })
      .passthrough()
      .optional(),
    reusableCharacterScreenshots: z
      .object({
        manifestPath: relativePacketPath,
        validationPath: relativePacketPath,
        selectionPlanPath: relativePacketPath,
        screenshotsPath: relativePacketPath,
        manifestSha256: packetSha,
        validationSha256: packetSha,
      })
      .passthrough()
      .optional(),
    requiredRepairs: z
      .array(
        z
          .object({
            sourceJobId: z.string().trim().min(1).max(128),
            findings: z
              .array(
                z
                  .object({
                    code: z.string().trim().min(1).max(128),
                    severity: z.string().trim().min(1).max(64),
                    message: z.string().trim().min(1).max(4000),
                  })
                  .strict()
              )
              .max(128),
          })
          .strict()
      )
      .max(32),
  })
  .passthrough();

const temporalShardOutputSchema = z
  .object({
    version: z.literal(1),
    shardId: z.string().trim().min(1).max(128),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    outcome: z.enum(["completed", "partial", "blocked"]),
    summary: z.string().trim().min(1).max(4_000),
    items: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            kind: z.enum([
              "transcript_interpretation",
              "speaker_attribution",
              "visual_observation",
              "episode_event",
              "narrative_beat",
              "lore_candidate",
            ]),
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().nonnegative(),
            summary: z.string().trim().min(1).max(4_000),
            participants: z.array(z.string().trim().min(1).max(256)).max(32),
            evidence: z
              .array(
                z
                  .object({
                    artifactType: z.string().trim().min(1).max(128),
                    artifactPath: relativePacketPath,
                    startMs: z.number().int().nonnegative(),
                    endMs: z.number().int().nonnegative(),
                    itemId: z.string().trim().min(1).max(128).optional(),
                  })
                  .strict()
              )
              .min(1)
              .max(32),
            confidence: z.number().min(0).max(1),
            details: z.record(z.string(), z.unknown()).optional(),
          })
          .strict()
      )
      .max(512),
    warnings: z.array(z.string().trim().min(1).max(2_000)).max(64),
  })
  .strict();

type InputPacket = z.infer<typeof inputPacketSchema>;

export type BoundedArtifactWorkflowCheckpoint = {
  version: typeof CHECKPOINT_VERSION;
  missionId: string;
  workItemId: string;
  episodeId: string;
  sessionId: string;
  lastRunId: string;
  inputPacket: { path: string; sha256: string };
  shards: Array<{
    shardId: string;
    startMs: number;
    endMs: number;
    inputPath: string;
    inputSha256: string;
    outputPath?: string;
    outputSha256?: string;
    status: "pending" | "verified" | "empty";
  }>;
  artifacts: Array<{
    type: string;
    path: string;
    sha256: string;
    status: "verified";
  }>;
  handoffState: BoundedArtifactHandoff["state"] | "pending";
  findings: BoundedArtifactWorkflowFinding[];
  updatedAt: number;
};

export type PreparedBoundedArtifactWorkflow = {
  request: BoundedArtifactWorkflowRequest;
  packet: InputPacket;
  cwd: string;
  checkpointPath: string;
  promptBlock: string;
  progress: BoundedArtifactWorkflowProgress;
};

export function prepareBoundedArtifactWorkflow(input: {
  request: unknown;
  cwd: string;
  hostSessionId: string;
  runId: string;
}): PreparedBoundedArtifactWorkflow {
  const request = boundedArtifactWorkflowRequestSchema.parse(input.request);
  assertWorkflowIdentity(request, input);
  const outputRoot = path.resolve(request.outputRoot);
  if (!isPathInsideRoot(outputRoot, input.cwd)) {
    throw new Error("Bounded artifact output root must stay inside the trusted cwd");
  }
  const packetPath = assertNamedFile(request.inputPacket.path, outputRoot);
  if (path.basename(packetPath).toLowerCase() !== "input-packet.v1.json") {
    throw new Error("Bounded artifact workflow requires input-packet.v1.json");
  }
  const packetBytes = statSync(packetPath).size;
  if (packetBytes > MAX_PACKET_BYTES) {
    throw new Error(`Input packet exceeds ${MAX_PACKET_BYTES} bytes`);
  }
  const packetText = readFileSync(packetPath, "utf8");
  if (sha256Text(packetText) !== request.inputPacket.sha256.toLowerCase()) {
    throw new Error("Input packet hash does not match the run contract");
  }
  const packet = inputPacketSchema.parse(JSON.parse(packetText));
  if (packet.episodeId !== request.episodeId) {
    throw new Error("Input packet episode does not match the run contract");
  }
  validatePacketRanges(packet);
  validateNamedPacketInputs(packet, outputRoot);

  const mission = readMission(request.missionId);
  if (!mission || !mission.workItems.some((item) => item.id === request.workItemId)) {
    throw new Error("Bounded artifact workflow requires its durable mission/work item");
  }

  const checkpointPath = path.join(
    getMissionDir(request.missionId),
    "artifact-workflows",
    `${request.workItemId}.json`
  );
  const prepared: PreparedBoundedArtifactWorkflow = {
    request,
    packet,
    cwd: path.resolve(input.cwd),
    checkpointPath,
    promptBlock: "",
    progress: emptyProgress(packet, request),
  };
  const checkpoint = refreshCheckpoint(prepared, input.hostSessionId, input.runId);
  prepared.progress = progressFromCheckpoint(checkpoint, request);
  prepared.promptBlock = buildExecutionReceipt(prepared, checkpoint);
  return prepared;
}

/** Refreshes only explicitly named shard/result paths; it never inventories a directory. */
export function refreshBoundedArtifactWorkflow(
  workflow: PreparedBoundedArtifactWorkflow
): BoundedArtifactWorkflowProgress {
  const checkpoint = refreshCheckpoint(
    workflow,
    workflow.request.expectedIdentity.sessionId,
    workflow.request.expectedIdentity.runId
  );
  workflow.progress = progressFromCheckpoint(checkpoint, workflow.request);
  return workflow.progress;
}

export function finalizeBoundedArtifactWorkflow(
  workflow: PreparedBoundedArtifactWorkflow
): BoundedArtifactHandoff {
  const findings: BoundedArtifactWorkflowFinding[] = [];
  const resultAbsolute = resolveInside(
    workflow.request.outputRoot,
    workflow.request.resultPath
  );
  let manifest: Record<string, unknown> | null = null;
  const parsedByType = new Map<string, unknown>();
  const verifiedArtifacts: BoundedArtifactWorkflowCheckpoint["artifacts"] = [];

  try {
    assertNamedFile(resultAbsolute, workflow.request.outputRoot);
    manifest = readJsonObject(resultAbsolute);
  } catch (error) {
    addFinding(findings, "result_manifest_invalid", messageOf(error), workflow.request.resultPath);
  }

  let declaredStatus = "invalid";
  if (manifest) {
    declaredStatus = typeof manifest.status === "string" ? manifest.status : "invalid";
    validateResultIdentity(manifest, workflow.request, findings);
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    if (!Array.isArray(manifest.artifacts)) {
      addFinding(findings, "artifact_manifest_invalid", "Result artifacts must be an array");
    }
    const seenTypes = new Set<string>();
    for (const raw of artifacts.slice(0, 128)) {
      const ref = asRecord(raw);
      const type = typeof ref?.type === "string" ? ref.type : "";
      const artifactPath = typeof ref?.path === "string" ? ref.path : "";
      if (!ref || !type || !artifactPath) {
        addFinding(findings, "artifact_ref_invalid", "Artifact ref requires type and path");
        continue;
      }
      if (seenTypes.has(type)) {
        addFinding(findings, "duplicate_artifact_type", `Duplicate ${type} artifact`, artifactPath);
        continue;
      }
      seenTypes.add(type);
      const absolute = resolveInside(workflow.request.outputRoot, artifactPath);
      try {
        assertNamedFile(absolute, workflow.request.outputRoot);
        const bytes = statSync(absolute).size;
        const digest = sha256File(absolute);
        if (ref.bytes !== bytes) {
          addFinding(findings, "artifact_size_mismatch", `Expected ${String(ref.bytes)} bytes, found ${bytes}`, artifactPath);
        }
        if (ref.sha256 !== digest) {
          addFinding(findings, "artifact_hash_mismatch", "SHA-256 does not match", artifactPath);
        }
        const parsed = parseArtifactPayload(type, absolute);
        parsedByType.set(type, parsed);
        if (ref.bytes === bytes && ref.sha256 === digest) {
          verifiedArtifacts.push({ type, path: artifactPath, sha256: digest, status: "verified" });
        }
      } catch (error) {
        addFinding(findings, "artifact_invalid", messageOf(error), artifactPath);
      }
    }
    if (declaredStatus === "complete") {
      for (const type of workflow.request.requiredArtifactTypes) {
        if (!seenTypes.has(type)) {
          addFinding(findings, "required_artifact_missing", `Missing ${type}`);
        }
      }
    }
    validateChronology(parsedByType, findings);
    validateLinkage(parsedByType, artifacts, findings);
    validateAttribution(parsedByType, findings);
    validateUnsupportedRepairs(workflow.packet, parsedByType, findings);
  }

  const checkpoint = refreshCheckpoint(
    workflow,
    workflow.request.expectedIdentity.sessionId,
    workflow.request.expectedIdentity.runId,
    verifiedArtifacts
  );
  const hasErrors = findings.some((finding) => finding.severity === "error");
  const state: BoundedArtifactHandoff["state"] = hasErrors
    ? "invalid"
    : declaredStatus === "complete"
      ? "validated"
      : declaredStatus === "partial"
        ? "partial"
        : declaredStatus === "blocked"
          ? "blocked"
          : "invalid";
  const nextCheckpoint: BoundedArtifactWorkflowCheckpoint = {
    ...checkpoint,
    artifacts: verifiedArtifacts,
    handoffState: state,
    findings: findings.slice(0, MAX_FINDINGS),
    updatedAt: Date.now(),
  };
  atomicWriteJson(workflow.checkpointPath, nextCheckpoint);
  workflow.progress = {
    ...progressFromCheckpoint(nextCheckpoint, workflow.request),
    phase: state === "validated" ? "complete" : "validation",
  };
  return {
    state,
    checkedAt: nextCheckpoint.updatedAt,
    manifestPath: resultAbsolute,
    checkpointPath: workflow.checkpointPath,
    findings: nextCheckpoint.findings,
    progress: workflow.progress,
  };
}

function assertWorkflowIdentity(
  request: BoundedArtifactWorkflowRequest,
  input: { hostSessionId: string; runId: string }
): void {
  if (request.expectedIdentity.sessionId !== input.hostSessionId) {
    throw new Error("Workflow session identity does not match the exact host session");
  }
  if (request.expectedIdentity.runId !== input.runId) {
    throw new Error("Workflow run identity does not match the managed run");
  }
}

function validatePacketRanges(packet: InputPacket): void {
  const ids = new Set<string>();
  let priorEnd = 0;
  for (const shard of packet.temporalShards) {
    if (ids.has(shard.shardId)) throw new Error(`Duplicate shard ${shard.shardId}`);
    ids.add(shard.shardId);
    if (shard.endMs <= shard.startMs) throw new Error(`Invalid range for ${shard.shardId}`);
    if (shard.startMs < priorEnd) throw new Error("Temporal shards overlap or are out of order");
    priorEnd = shard.endMs;
  }
}

function validateNamedPacketInputs(packet: InputPacket, root: string): void {
  const verifyRelative = (relative: string, expectedHash?: string) => {
    const absolute = assertNamedFile(resolveInside(root, relative), root);
    if (expectedHash && sha256File(absolute) !== expectedHash.toLowerCase()) {
      throw new Error(`Reusable input hash mismatch: ${relative}`);
    }
  };
  const transcript = packet.immutableAsr ?? packet.validatedPriorTranscript;
  if (transcript) verifyRelative(transcript.transcriptPath, transcript.sha256);
  for (const shard of packet.temporalShards) {
    verifyRelative(shard.transcriptPath);
    if (shard.visualObservationPath) verifyRelative(shard.visualObservationPath);
  }
  if (packet.reusableMediaManifestPath) verifyRelative(packet.reusableMediaManifestPath);
  if (packet.reusableSpeakerEvidence) {
    const item = packet.reusableSpeakerEvidence;
    verifyRelative(item.manifestPath, item.manifestSha256);
    verifyRelative(item.validationPath, item.validationSha256);
    verifyRelative(item.transcriptPath);
    verifyRelative(item.wordTimingsPath);
    verifyRelative(item.diarizationSegmentsPath);
  }
  if (packet.reusableCharacterScreenshots) {
    const item = packet.reusableCharacterScreenshots;
    verifyRelative(item.manifestPath, item.manifestSha256);
    verifyRelative(item.validationPath, item.validationSha256);
    verifyRelative(item.selectionPlanPath);
    verifyRelative(item.screenshotsPath);
  }
}

function refreshCheckpoint(
  workflow: PreparedBoundedArtifactWorkflow,
  sessionId: string,
  runId: string,
  artifacts?: BoundedArtifactWorkflowCheckpoint["artifacts"]
): BoundedArtifactWorkflowCheckpoint {
  const prior = readCheckpoint(workflow.checkpointPath);
  const shards = workflow.packet.temporalShards.map((shard, index) => {
    const inputAbsolute = resolveInside(workflow.request.outputRoot, shard.transcriptPath);
    if (shard.transcriptLines === 0) {
      return {
        shardId: shard.shardId,
        startMs: shard.startMs,
        endMs: shard.endMs,
        inputPath: shard.transcriptPath,
        inputSha256: sha256File(inputAbsolute),
        status: "empty" as const,
      };
    }
    const output = findShardOutput(workflow, shard.shardId, index);
    return {
      shardId: shard.shardId,
      startMs: shard.startMs,
      endMs: shard.endMs,
      inputPath: shard.transcriptPath,
      inputSha256: sha256File(inputAbsolute),
      ...(output
        ? { outputPath: output.relative, outputSha256: output.sha256, status: "verified" as const }
        : { status: "pending" as const }),
    };
  });
  const sameInput =
    prior?.inputPacket.sha256.toLowerCase() ===
    workflow.request.inputPacket.sha256.toLowerCase();
  const checkpoint: BoundedArtifactWorkflowCheckpoint = {
    version: CHECKPOINT_VERSION,
    missionId: workflow.request.missionId,
    workItemId: workflow.request.workItemId,
    episodeId: workflow.request.episodeId,
    sessionId,
    lastRunId: runId,
    inputPacket: { ...workflow.request.inputPacket },
    shards,
    artifacts: artifacts ?? (sameInput ? prior?.artifacts : undefined) ?? [],
    handoffState: sameInput ? prior?.handoffState ?? "pending" : "pending",
    findings: sameInput ? prior?.findings ?? [] : [],
    updatedAt: Date.now(),
  };
  if (prior && checkpointContent(prior) === checkpointContent(checkpoint)) {
    return prior;
  }
  atomicWriteJson(workflow.checkpointPath, checkpoint);
  return checkpoint;
}

function findShardOutput(
  workflow: PreparedBoundedArtifactWorkflow,
  shardId: string,
  index: number
): { relative: string; sha256: string } | null {
  const candidates = [
    `_spok/shards/${shardId}.analysis.v1.json`,
    `work-shard-${index}-analysis.json`,
    `_leaf_shard_${index}_analysis.json`,
    `_work_shard_${index}_result.json`,
    `_work_shard_${index}.json`,
  ];
  for (const relative of candidates) {
    const absolute = resolveInside(workflow.request.outputRoot, relative);
    if (!existsSync(absolute)) continue;
    try {
      assertNamedFile(absolute, workflow.request.outputRoot);
      if (statSync(absolute).size > MAX_SHARD_OUTPUT_BYTES) continue;
      const parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object") continue;
      if (relative.startsWith("_spok/")) {
        const result = temporalShardOutputSchema.safeParse(parsed);
        if (!result.success) continue;
        const record = result.data;
        if (
          record.shardId !== shardId ||
          record.startMs !== workflow.packet.temporalShards[index]?.startMs ||
          record.endMs !== workflow.packet.temporalShards[index]?.endMs ||
          record.outcome !== "completed" ||
          !isValidShardItems(record)
        ) {
          continue;
        }
      }
      return { relative, sha256: sha256File(absolute) };
    } catch {
      continue;
    }
  }
  return null;
}

function buildExecutionReceipt(
  workflow: PreparedBoundedArtifactWorkflow,
  checkpoint: BoundedArtifactWorkflowCheckpoint
): string {
  const completed = checkpoint.shards.filter((shard) => shard.status === "verified");
  const pending = checkpoint.shards.filter((shard) => shard.status === "pending");
  const schemas = [
    "archive-analysis-result.v1.schema.json",
    ...workflow.request.requiredArtifactTypes
      .map((type) => artifactSchemaName(type))
      .filter((value): value is string => !!value),
  ];
  const repairs = workflow.packet.requiredRepairs.flatMap((repair) =>
    repair.findings.map(
      (finding) => `${finding.code}: ${finding.message} (source ${repair.sourceJobId})`
    )
  );
  const reuse: string[] = [];
  if (workflow.packet.immutableAsr || workflow.packet.validatedPriorTranscript) {
    reuse.push("immutable transcript/ASR");
  }
  if (workflow.packet.reusableSpeakerEvidence) reuse.push("speaker evidence");
  if (workflow.packet.reusableMediaManifestPath) reuse.push("media manifest");
  if (workflow.packet.reusableCharacterScreenshots) reuse.push("character screenshots");
  return [
    "SPOK BOUNDED ARTIFACT WORKFLOW v1 — EXECUTION RECEIPT",
    `Mission/work item: ${workflow.request.missionId} / ${workflow.request.workItemId}`,
    `Exact leader session/run: ${workflow.request.expectedIdentity.sessionId} / ${workflow.request.expectedIdentity.runId}`,
    `Input packet: ${workflow.request.inputPacket.path} (sha256 ${workflow.request.inputPacket.sha256})`,
    `Durable checkpoint: ${workflow.checkpointPath}`,
    "Read input-packet.v1.json directly. Do not recursively inventory the workspace, media, schemas, frames, or staging root.",
    reuse.length
      ? `Reuse without recomputation: ${reuse.join(", ")}. Do not rerun ASR, diarization, scene detection, or screenshot extraction for supplied validated evidence.`
      : "No reusable evidence bundle was declared; report a genuine missing-input blocker rather than inventing evidence.",
    pending.length
      ? [
          "Launch exactly one parallel wave containing only these non-empty, non-overlapping temporal specialists:",
          ...pending.map((shard) => {
            const source = workflow.packet.temporalShards.find((item) => item.shardId === shard.shardId)!;
            return `- ${shard.shardId} [${shard.startMs}, ${shard.endMs}) transcript=${source.transcriptPath}${source.visualObservationPath ? ` visual=${source.visualObservationPath}` : ""} -> _spok/shards/${shard.shardId}.analysis.v1.json`;
          }),
          "Each specialist is a leaf, reads only its named inputs, and writes one compact JSON object: {version:1, shardId, startMs, endMs, outcome:'completed', summary, items:[{id, kind, startMs, endMs, summary, participants, evidence:[{artifactType, artifactPath, startMs, endMs, itemId?}], confidence, details?}], warnings}. Items must be chronological, contained in the shard, and evidence-linked. Do not launch a second wave.",
        ].join("\n")
      : "All temporal shards have verified outputs. Do not relaunch specialists or reread the full transcript; begin mechanical integration now.",
    completed.length
      ? `Verified completed shard outputs to integrate: ${completed.map((item) => item.outputPath).join(", ")}`
      : "No prior shard output is verified.",
    schemas.length
      ? `Read only the required schemas: ${schemas.map((name) => path.join(workflow.cwd, "schemas", name)).join(", ")}`
      : "Use the result contract named by the analytical policy.",
    repairs.length
      ? `Mandatory repair dispositions:\n${repairs.map((item) => `- ${item}`).join("\n")}`
      : "No prior repair finding was declared.",
    `Required artifact types for complete: ${workflow.request.requiredArtifactTypes.join(", ")}`,
    `Required result: ${resolveInside(workflow.request.outputRoot, workflow.request.resultPath)}`,
    "Before claiming complete, perform one integrated critic pass for contract shape, attribution, chronology, evidence linkage, unsupported claims, and required artifacts. The runtime independently gates the handoff and preserves exact findings for resume.",
    "Do not stop at an inventory or progress report. Finish the handoff, or write a truthful partial/blocked manifest with exact remaining shards/stages.",
  ].join("\n\n");
}

function isValidShardItems(
  output: z.infer<typeof temporalShardOutputSchema>
): boolean {
  const ids = new Set<string>();
  let priorStart = -1;
  for (const item of output.items) {
    if (
      ids.has(item.id) ||
      item.endMs < item.startMs ||
      item.startMs < output.startMs ||
      item.endMs > output.endMs ||
      item.startMs < priorStart
    ) {
      return false;
    }
    ids.add(item.id);
    priorStart = item.startMs;
    if (
      item.evidence.some(
        (evidence) =>
          evidence.endMs < evidence.startMs ||
          evidence.startMs < output.startMs ||
          evidence.endMs > output.endMs
      )
    ) {
      return false;
    }
  }
  return true;
}

function progressFromCheckpoint(
  checkpoint: BoundedArtifactWorkflowCheckpoint,
  request: BoundedArtifactWorkflowRequest
): BoundedArtifactWorkflowProgress {
  const completedShards = checkpoint.shards.filter((item) => item.status === "verified").length;
  const totalShards = checkpoint.shards.filter((item) => item.status !== "empty").length;
  const verifiedArtifacts = checkpoint.artifacts.filter((artifact) =>
    request.requiredArtifactTypes.includes(
      artifact.type as (typeof request.requiredArtifactTypes)[number]
    )
  ).length;
  const phase = checkpoint.handoffState === "validated"
    ? "complete"
    : completedShards < totalShards
      ? "specialists"
      : verifiedArtifacts < request.requiredArtifactTypes.length
        ? "integration"
        : "validation";
  return {
    completedShards,
    totalShards,
    verifiedArtifacts,
    requiredArtifacts: request.requiredArtifactTypes.length,
    phase,
    checkpointAt: checkpoint.updatedAt,
  };
}

function emptyProgress(
  packet: InputPacket,
  request: BoundedArtifactWorkflowRequest
): BoundedArtifactWorkflowProgress {
  return {
    completedShards: 0,
    totalShards: packet.temporalShards.filter((shard) => shard.transcriptLines > 0).length,
    verifiedArtifacts: 0,
    requiredArtifacts: request.requiredArtifactTypes.length,
    phase: "specialists",
    checkpointAt: Date.now(),
  };
}

function validateResultIdentity(
  manifest: Record<string, unknown>,
  request: BoundedArtifactWorkflowRequest,
  findings: BoundedArtifactWorkflowFinding[]
): void {
  const spok = asRecord(manifest.spok) ?? {};
  const actual = {
    jobId: manifest.jobId,
    missionId: spok.missionId,
    workItemId: spok.workItemId,
    sessionId: spok.sessionId,
    runId: spok.runId,
    capabilityFingerprint: spok.capabilityFingerprint,
  };
  for (const [key, expected] of Object.entries(request.expectedIdentity)) {
    if (actual[key as keyof typeof actual] !== expected) {
      addFinding(findings, "result_identity_mismatch", `${key} does not match the run receipt`);
    }
  }
}

function parseArtifactPayload(type: string, file: string): unknown {
  const size = statSync(file).size;
  if (size > MAX_JSON_ARTIFACT_BYTES) throw new Error("Structured artifact exceeds validation limit");
  const text = readFileSync(file, "utf8");
  if (JSONL_TYPES.has(type)) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch (error) {
          throw new Error(`Invalid JSONL at line ${index + 1}: ${messageOf(error)}`);
        }
      });
  }
  return JSON.parse(text) as unknown;
}

const JSONL_TYPES = new Set([
  "transcript",
  "attributed_transcript",
  "word_timings",
  "diarization_segments",
  "scene_segments",
  "character_screenshots",
  "character_appearance_observations",
  "visual_observations",
  "episode_events",
]);

function validateChronology(
  parsed: Map<string, unknown>,
  findings: BoundedArtifactWorkflowFinding[]
): void {
  for (const [type, value] of parsed) {
    if (!Array.isArray(value)) continue;
    let priorStart = -1;
    for (const raw of value) {
      const item = asRecord(raw);
      if (!item || typeof item.startMs !== "number") continue;
      if (typeof item.endMs === "number" && item.endMs < item.startMs) {
        addFinding(findings, `${type}_range`, `${type} item ends before it starts`);
      }
      if (item.startMs < priorStart) {
        addFinding(findings, `${type}_chronology`, `${type} items are not chronological`);
      }
      priorStart = item.startMs;
    }
  }
  for (const type of ["episode_events", "episode_analysis"]) {
    const root = parsed.get(type);
    const items = type === "episode_events"
      ? root
      : asRecord(root)?.narrativeBeats;
    if (!Array.isArray(items)) continue;
    let prior = -1;
    const sequences = new Set<number>();
    for (const raw of items) {
      const item = asRecord(raw);
      if (!item) continue;
      if (typeof item.sequence === "number") {
        if (sequences.has(item.sequence)) addFinding(findings, `${type}_sequence_duplicate`, `${type} sequence is duplicated`);
        sequences.add(item.sequence);
      }
      const evidence = Array.isArray(item.evidence) ? item.evidence : [];
      const starts = evidence
        .map((entry) => asRecord(entry)?.startMs)
        .filter((entry): entry is number => typeof entry === "number");
      if (starts.length === 0) continue;
      const earliest = Math.min(...starts);
      if (earliest < prior) addFinding(findings, `${type}_evidence_chronology`, `${type} is out of evidence chronology`);
      prior = earliest;
    }
  }
  const cast = asRecord(parsed.get("episode_analysis"))?.cast;
  if (Array.isArray(cast)) {
    const names = new Set<string>();
    for (const raw of cast) {
      const name = asRecord(raw)?.displayName;
      if (typeof name !== "string") continue;
      const normalized = name.trim().toLowerCase();
      if (names.has(normalized)) addFinding(findings, "duplicate_cast_identity", `Duplicate cast identity ${name}`);
      names.add(normalized);
    }
  }
}

function validateLinkage(
  parsed: Map<string, unknown>,
  rawArtifacts: unknown[],
  findings: BoundedArtifactWorkflowFinding[]
): void {
  const artifactPaths = new Map<string, string>();
  for (const raw of rawArtifacts) {
    const ref = asRecord(raw);
    if (typeof ref?.type === "string" && typeof ref.path === "string") {
      artifactPaths.set(ref.type, ref.path);
    }
  }
  const ids = new Map<string, Set<string>>();
  for (const [type, value] of parsed) {
    if (!Array.isArray(value)) continue;
    const set = new Set<string>();
    for (const raw of value) {
      const item = asRecord(raw);
      const id = item?.id ?? item?.utteranceId;
      if (typeof id === "string") set.add(id);
    }
    ids.set(type, set);
  }
  const transcriptIds = ids.get("transcript") ?? new Set<string>();
  const attributed = parsed.get("attributed_transcript");
  if (Array.isArray(attributed)) {
    for (const raw of attributed) {
      const item = asRecord(raw);
      if (!item || !Array.isArray(item.rawLineIds)) continue;
      for (const rawId of item.rawLineIds) {
        if (typeof rawId === "string" && !transcriptIds.has(rawId)) {
          addFinding(findings, "attribution_raw_line_missing", `Attributed utterance references missing raw line ${rawId}`);
        }
      }
    }
  }
  for (const value of parsed.values()) {
    walkObjects(value, (item) => {
      if (
        typeof item.artifactType !== "string" ||
        typeof item.artifactPath !== "string" ||
        typeof item.startMs !== "number" ||
        typeof item.endMs !== "number"
      ) return;
      const expectedPath = artifactPaths.get(item.artifactType);
      if (!expectedPath || expectedPath !== item.artifactPath) {
        addFinding(findings, "evidence_artifact_missing", `Evidence references unavailable ${item.artifactType} artifact`, item.artifactPath);
      }
      if (item.endMs < item.startMs) addFinding(findings, "evidence_range_invalid", "Evidence ends before it starts", item.artifactPath);
      if (typeof item.itemId === "string") {
        const targetIds = ids.get(item.artifactType);
        if (targetIds && !targetIds.has(item.itemId)) {
          addFinding(findings, "evidence_item_missing", `Evidence item ${item.itemId} is missing`, item.artifactPath);
        }
      }
    });
  }
}

function validateAttribution(
  parsed: Map<string, unknown>,
  findings: BoundedArtifactWorkflowFinding[]
): void {
  const value = parsed.get("attributed_transcript");
  if (!Array.isArray(value)) return;
  for (const raw of value) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = typeof item.utteranceId === "string" ? item.utteranceId : "unknown";
    if (item.discourseMode === "out_of_character" && item.personaId !== null) {
      addFinding(findings, "attribution_ooc_persona", `${id}: out-of-character speech cannot identify an in-world persona`);
    }
    if (["host_natural", "host_character"].includes(String(item.voiceStyle))) {
      if (item.performerId !== "performer_primary_streamer") {
        addFinding(findings, "host_performer_identity_drift", `${id}: host speech must use performer_primary_streamer`);
      }
      const evidence = Array.isArray(item.attributionEvidence) ? item.attributionEvidence : [];
      if (!evidence.some((entry) => asRecord(entry)?.kind === "acoustic_profile")) {
        addFinding(findings, "host_acoustic_evidence_missing", `${id}: host speech lacks acoustic-profile evidence`);
      }
    }
    if (item.voiceStyle === "host_natural") {
      if (item.voiceProfileId !== "voice_primary_streamer_natural") {
        addFinding(findings, "host_natural_profile_drift", `${id}: natural host voice profile is invalid`);
      }
      if (item.personaId !== null && item.discourseMode !== "in_character") {
        addFinding(findings, "host_natural_persona_drift", `${id}: natural host speech should not identify Wallaby Kid`);
      }
    }
    if (item.voiceStyle === "host_character") {
      if (item.voiceProfileId !== "voice_wallaby_kid_character") {
        addFinding(findings, "host_character_profile_drift", `${id}: Wallaby Kid voice profile is invalid`);
      }
      if (item.discourseMode === "in_character" && item.personaId !== "persona_wallaby_kid") {
        addFinding(findings, "wallaby_kid_persona_drift", `${id}: in-character Wallaby Kid speech must use persona_wallaby_kid`);
      }
    }
    if (
      ["host_character", "participant_character", "game_character"].includes(String(item.voiceStyle)) &&
      item.discourseMode === "in_character" &&
      item.personaId == null
    ) {
      addFinding(findings, "attribution_persona_missing", `${id}: in-character character speech needs a persona or ambiguous discourse`);
    }
  }
}

function validateUnsupportedRepairs(
  packet: InputPacket,
  parsed: Map<string, unknown>,
  findings: BoundedArtifactWorkflowFinding[]
): void {
  const quality = asRecord(parsed.get("quality_report"));
  if (Array.isArray(quality?.unsupportedClaimIds) && quality.unsupportedClaimIds.length > 0) {
    addFinding(findings, "unsupported_claims", `Quality report lists unsupported claims: ${quality.unsupportedClaimIds.join(", ")}`);
  }
  const claims = new Set<string>(["lp_alias_wobbly"]);
  for (const repair of packet.requiredRepairs) {
    for (const finding of repair.findings) {
      for (const match of finding.message.matchAll(/\b(?:lp|claim|alias)_[A-Za-z0-9._-]+\b/g)) {
        claims.add(match[0]);
      }
    }
  }
  const lore = asRecord(parsed.get("lore_delta"));
  const proposals = Array.isArray(lore?.proposals) ? lore.proposals : [];
  const critic = Array.isArray(quality?.criticFindings)
    ? quality.criticFindings.filter((item): item is string => typeof item === "string")
    : [];
  for (const claim of claims) {
    const proposal = proposals.find((item) => JSON.stringify(item).includes(claim));
    if (!proposal) continue;
    const proposalRecord = asRecord(proposal);
    const hasEvidence = Array.isArray(proposalRecord?.evidence) && proposalRecord.evidence.length > 0;
    const hasDirectDisposition = critic.some(
      (item) => item.includes(claim) && /\bnew\s+direct\s+evidence\b/i.test(item)
    );
    if (!hasEvidence || !hasDirectDisposition) {
      addFinding(findings, "required_repair_reappeared", `${claim} reappeared without an explicit new-direct-evidence disposition`);
    }
  }
}

function artifactSchemaName(type: string): string | null {
  const names: Record<string, string> = {
    media_manifest: "media-manifest.v1.schema.json",
    transcript: "transcript-line.v1.schema.json",
    attributed_transcript: "attributed-transcript.v2.schema.json",
    transcript_attribution_manifest: "transcript-attribution-manifest.v2.schema.json",
    word_timings: "word-timing.v1.schema.json",
    diarization_segments: "diarization-segment.v1.schema.json",
    speaker_evidence_manifest: "speaker-evidence-manifest.v1.schema.json",
    scene_segments: "scene-segment.v1.schema.json",
    scene_detection_manifest: "scene-detection-manifest.v1.schema.json",
    character_screenshots: "character-screenshot.v1.schema.json",
    character_screenshot_manifest: "character-screenshot-manifest.v1.schema.json",
    character_appearance_observations: "character-appearance-observation.v1.schema.json",
    character_visual_progression: "character-visual-progression.v1.schema.json",
    visual_observations: "visual-observation.v1.schema.json",
    episode_events: "episode-event.v1.schema.json",
    episode_analysis: "episode-analysis.v1.schema.json",
    lore_delta: "lore-delta.v1.schema.json",
    quality_report: "quality-report.v1.schema.json",
  };
  return names[type] ?? null;
}

function readCheckpoint(file: string): BoundedArtifactWorkflowCheckpoint | null {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as BoundedArtifactWorkflowCheckpoint;
    return value?.version === CHECKPOINT_VERSION ? value : null;
  } catch {
    return null;
  }
}

function checkpointContent(checkpoint: BoundedArtifactWorkflowCheckpoint): string {
  return JSON.stringify({ ...checkpoint, updatedAt: 0 });
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const nonce = `${process.pid}.${Math.random().toString(36).slice(2)}`;
  const temp = `${file}.${nonce}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temp, file);
  } catch (error) {
    if (existsSync(file)) {
      const backup = `${file}.${nonce}.bak`;
      try {
        renameSync(file, backup);
        try {
          renameSync(temp, file);
        } catch (promotionError) {
          renameSync(backup, file);
          throw promotionError;
        }
        try {
          unlinkSync(backup);
        } catch {
          /* stale backup is safer than losing the checkpoint */
        }
        return;
      } catch {
        /* fall through to original cleanup/error */
      }
    }
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

function assertNamedFile(file: string, root: string): string {
  const resolved = path.resolve(file);
  if (!isPathInsideRoot(resolved, root)) throw new Error("Named file escapes the authorized root");
  if (!existsSync(resolved)) throw new Error(`Named file is missing: ${resolved}`);
  const info = lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Named path is not a regular file: ${resolved}`);
  return resolved;
}

function resolveInside(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (!isPathInsideRoot(resolved, root)) throw new Error(`Path escapes output root: ${relative}`);
  return resolved;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readJsonObject(file: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const record = asRecord(value);
  if (!record) throw new Error("JSON value must be an object");
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function walkObjects(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walkObjects(child, visit);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  visit(record);
  for (const child of Object.values(record)) walkObjects(child, visit);
}

function addFinding(
  findings: BoundedArtifactWorkflowFinding[],
  code: string,
  message: string,
  artifactPath?: string
): void {
  if (findings.length >= MAX_FINDINGS) return;
  findings.push({
    code,
    severity: "error",
    message,
    ...(artifactPath ? { path: artifactPath } : {}),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
