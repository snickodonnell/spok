import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createMission } from "../../src/lib/missions";
import {
  finalizeBoundedArtifactWorkflow,
  prepareBoundedArtifactWorkflow,
  refreshBoundedArtifactWorkflow,
} from "../../src/lib/runtime/bounded-artifact-workflow";

let root = "";
let workspace = "";
let staging = "";
let previousSpokHome: string | undefined;

const sessionId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  previousSpokHome = process.env.SPOK_HOME;
  root = mkdtempSync(path.join(os.tmpdir(), "spok-bounded-artifacts-"));
  workspace = path.join(root, "workspace");
  staging = path.join(workspace, "data", "staging", "job_1");
  mkdirSync(staging, { recursive: true });
  process.env.SPOK_HOME = path.join(root, "spok-home");
  const created = createMission({
    id: "mission_wallaby_1",
    outcome: "Produce a validated episode handoff",
    definitionOfDone: ["Required artifacts validate"],
    policyRef: "wallaby-test",
    repository: workspace,
    budgets: { tokens: 100_000, retries: 1 },
    authority: {
      policyRef: "wallaby-test",
      capabilities: ["media-analysis"],
      repository: workspace,
    },
    workItems: [
      {
        id: "work_wallaby_1",
        title: "Analyze temporal shards",
        owner: "spok",
        requestedCapability: "media-analysis",
        dependencies: [],
        budgets: { tokens: 50_000, retries: 1 },
        expectedEvidence: ["archive-analysis-result.v1.json"],
        retries: { max: 1, used: 0 },
        status: "ready",
        statusProvenance: { at: 1, source: "spok", reason: "Ready" },
      },
    ],
  });
  assert.equal(created.ok, true);
});

afterEach(() => {
  if (previousSpokHome === undefined) delete process.env.SPOK_HOME;
  else process.env.SPOK_HOME = previousSpokHome;
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe("bounded artifact workflow", { concurrency: false }, () => {
  it("consumes the packet directly and resumes from four verified legacy shards", () => {
    const packet = writeInputPacket();
    const first = prepare("run_wallaby_1", packet);
    assert.equal(first.progress.totalShards, 4);
    assert.equal(first.progress.completedShards, 0);
    assert.match(first.promptBlock, /exactly one parallel wave/i);
    assert.match(first.promptBlock, /do not recursively inventory/i);
    assert.match(first.promptBlock, /reuse without recomputation:.*speaker evidence/i);
    assert.match(first.promptBlock, /lp_alias_wobbly/i);
    assert.equal(existsSync(first.checkpointPath), true);
    const initialCheckpoint = JSON.parse(readFileSync(first.checkpointPath, "utf8")) as {
      updatedAt: number;
    };
    refreshBoundedArtifactWorkflow(first);
    const unchangedCheckpoint = JSON.parse(readFileSync(first.checkpointPath, "utf8")) as {
      updatedAt: number;
    };
    assert.equal(unchangedCheckpoint.updatedAt, initialCheckpoint.updatedAt);

    for (let index = 0; index < 4; index += 1) {
      writeJson(`_work_shard_${index}.json`, {
        shardId: `legacy_${index}`,
        observations: [{ summary: `bounded shard ${index}` }],
      });
    }

    const resumed = prepare("run_wallaby_2", packet);
    assert.equal(resumed.progress.completedShards, 4);
    assert.equal(resumed.progress.phase, "integration");
    assert.match(resumed.promptBlock, /all temporal shards have verified outputs/i);
    assert.doesNotMatch(resumed.promptBlock, /launch exactly one parallel wave/i);
    const checkpoint = JSON.parse(readFileSync(resumed.checkpointPath, "utf8")) as {
      sessionId: string;
      lastRunId: string;
      shards: Array<{ status: string; outputPath?: string }>;
    };
    assert.equal(checkpoint.sessionId, sessionId);
    assert.equal(checkpoint.lastRunId, "run_wallaby_2");
    assert.ok(checkpoint.shards.every((item) => item.status === "verified"));
  });

  it("blocks terminal success for attribution and unsupported-claim violations", () => {
    const packet = writeInputPacket();
    for (let index = 0; index < 4; index += 1) {
      writeJson(`_spok/shards/shard_${index}.analysis.v1.json`, {
        version: 1,
        shardId: `shard_${index}`,
        startMs: index * 1_000,
        endMs: (index + 1) * 1_000,
        outcome: "completed",
        summary: `Shard ${index} analyzed`,
        items: [],
        warnings: [],
      });
    }
    const prepared = prepare("run_wallaby_3", packet);
    writeHandoff({ invalidAttribution: true, reintroduceUnsupported: true });
    const invalid = finalizeBoundedArtifactWorkflow(prepared);
    assert.equal(invalid.state, "invalid");
    assert.ok(invalid.findings.some((finding) => finding.code === "attribution_persona_missing"));
    assert.ok(invalid.findings.some((finding) => finding.code === "required_repair_reappeared"));

    writeHandoff({ invalidAttribution: false, reintroduceUnsupported: false });
    const valid = finalizeBoundedArtifactWorkflow(prepared);
    assert.equal(valid.state, "validated");
    assert.equal(valid.progress.phase, "complete");
    assert.equal(valid.progress.completedShards, 4);
    assert.equal(valid.progress.verifiedArtifacts, valid.progress.requiredArtifacts);
  });

  it("does not spend a specialist lane on an empty temporal shard", () => {
    const packet = writeInputPacket();
    const parsed = JSON.parse(readFileSync(packet.path, "utf8")) as {
      temporalShards: Array<{ shardId: string; transcriptLines: number }>;
    };
    parsed.temporalShards[3]!.transcriptLines = 0;
    writeFileSync(path.join(staging, "input-transcript-shard-3.jsonl"), "", "utf8");
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    writeFileSync(packet.path, text, "utf8");

    const prepared = prepare("run_wallaby_empty", {
      path: packet.path,
      sha256: sha256(Buffer.from(text)),
    });
    assert.equal(prepared.progress.totalShards, 3);
    assert.doesNotMatch(prepared.promptBlock, /shard_3 \[/);
    const checkpoint = JSON.parse(readFileSync(prepared.checkpointPath, "utf8")) as {
      shards: Array<{ shardId: string; status: string }>;
    };
    assert.equal(
      checkpoint.shards.find((shard) => shard.shardId === "shard_3")?.status,
      "empty"
    );
  });
});

function prepare(runId: string, packet: { path: string; sha256: string }) {
  return prepareBoundedArtifactWorkflow({
    cwd: workspace,
    hostSessionId: sessionId,
    runId,
    request: workflowRequest(runId, packet),
  });
}

function workflowRequest(runId: string, packet: { path: string; sha256: string }) {
  return {
    version: 1,
    kind: "wallaby_archive",
    missionId: "mission_wallaby_1",
    workItemId: "work_wallaby_1",
    episodeId: "episode_wallaby_1",
    inputPacket: packet,
    outputRoot: staging,
    resultPath: "archive-analysis-result.v1.json",
    requiredArtifactTypes: [
      "media_manifest",
      "transcript",
      "attributed_transcript",
      "visual_observations",
      "episode_events",
      "episode_analysis",
      "lore_delta",
      "quality_report",
    ],
    expectedIdentity: {
      jobId: "job_wallaby_1",
      missionId: "mission_wallaby_1",
      workItemId: "work_wallaby_1",
      sessionId,
      runId,
      capabilityFingerprint: "capability_wallaby_1",
    },
  };
}

function writeInputPacket(): { path: string; sha256: string } {
  const transcript = `${JSON.stringify({ version: 1, id: "raw_1", startMs: 0, endMs: 4_000, text: "hello" })}\n`;
  writeText("transcript.v1.jsonl", transcript);
  const transcriptSha = sha256(Buffer.from(transcript));
  for (let index = 0; index < 4; index += 1) {
    writeText(
      `input-transcript-shard-${index}.jsonl`,
      `${JSON.stringify({ version: 1, id: `raw_${index}`, startMs: index * 1_000, endMs: (index + 1) * 1_000, text: `line ${index}` })}\n`
    );
  }
  const speakerFiles = [
    "input-speaker-evidence/manifest.json",
    "input-speaker-evidence/validation.json",
    "input-speaker-evidence/transcript.jsonl",
    "input-speaker-evidence/words.jsonl",
    "input-speaker-evidence/diarization.jsonl",
  ];
  for (const file of speakerFiles) writeText(file, file.endsWith(".json") ? "{}\n" : "");
  const packet = {
    version: 1,
    episodeId: "episode_wallaby_1",
    immutableAsr: {
      transcriptPath: "transcript.v1.jsonl",
      sha256: transcriptSha,
      lineCount: 1,
      receiptPath: "receipt.json",
      metadataPath: "metadata.json",
    },
    temporalShards: Array.from({ length: 4 }, (_, index) => ({
      shardId: `shard_${index}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      transcriptPath: `input-transcript-shard-${index}.jsonl`,
      transcriptLines: 1,
    })),
    reusableSpeakerEvidence: {
      rootPath: "input-speaker-evidence",
      manifestPath: speakerFiles[0],
      validationPath: speakerFiles[1],
      transcriptPath: speakerFiles[2],
      wordTimingsPath: speakerFiles[3],
      diarizationSegmentsPath: speakerFiles[4],
      manifestSha256: sha256(readFileSync(path.join(staging, speakerFiles[0]))),
      validationSha256: sha256(readFileSync(path.join(staging, speakerFiles[1]))),
      completedRange: { startMs: 0, endMs: 4_000 },
      clusterPolicy: "Spok reconciles identities",
    },
    requiredRepairs: [
      {
        sourceJobId: "prior_job",
        findings: [
          {
            code: "unsupported_claims",
            severity: "error",
            message: "Remove unsupported claim lp_alias_wobbly",
          },
        ],
      },
    ],
  };
  const text = `${JSON.stringify(packet, null, 2)}\n`;
  const packetPath = path.join(staging, "input-packet.v1.json");
  writeFileSync(packetPath, text, "utf8");
  return { path: packetPath, sha256: sha256(Buffer.from(text)) };
}

function writeHandoff(input: { invalidAttribution: boolean; reintroduceUnsupported: boolean }): void {
  const transcriptPath = writeText(
    "transcript.v1.jsonl",
    `${JSON.stringify({ version: 1, id: "raw_1", startMs: 0, endMs: 1_000, text: "Howdy" })}\n`
  );
  const attributedPath = writeText(
    "attributed-transcript.v2.jsonl",
    `${JSON.stringify({
      version: 2,
      utteranceId: "utterance_1",
      startMs: 0,
      endMs: 1_000,
      rawLineIds: ["raw_1"],
      voiceStyle: "host_character",
      voiceProfileId: "voice_wallaby_kid_character",
      discourseMode: "in_character",
      performerId: "performer_primary_streamer",
      personaId: input.invalidAttribution ? null : "persona_wallaby_kid",
      attributionEvidence: [{ kind: "acoustic_profile" }],
    })}\n`
  );
  const visualPath = writeText(
    "visual-observations.v1.jsonl",
    `${JSON.stringify({ version: 1, id: "visual_1", startMs: 0, endMs: 1_000 })}\n`
  );
  const eventsPath = writeText(
    "episode-events.v1.jsonl",
    `${JSON.stringify({
      version: 1,
      id: "event_1",
      sequence: 0,
      evidence: [{ artifactType: "transcript", artifactPath: "transcript.v1.jsonl", startMs: 0, endMs: 1_000, itemId: "raw_1" }],
    })}\n`
  );
  const files = [
    ["media_manifest", writeJson("media-manifest.v1.json", { version: 1, episodeId: "episode_wallaby_1", durationMs: 4_000 })],
    ["transcript", transcriptPath],
    ["attributed_transcript", attributedPath],
    ["visual_observations", visualPath],
    ["episode_events", eventsPath],
    [
      "episode_analysis",
      writeJson("episode-analysis.v1.json", {
        version: 1,
        episodeId: "episode_wallaby_1",
        narrativeBeats: [
          {
            sequence: 0,
            evidence: [{ artifactType: "transcript", artifactPath: "transcript.v1.jsonl", startMs: 0, endMs: 1_000, itemId: "raw_1" }],
          },
        ],
        cast: [{ displayName: "Wallaby Kid" }],
      }),
    ],
    [
      "lore_delta",
      writeJson("lore-delta.v1.json", {
        version: 1,
        episodeId: "episode_wallaby_1",
        proposals: input.reintroduceUnsupported
          ? [{ proposalId: "lp_alias_wobbly", evidence: [{ artifactType: "transcript", artifactPath: "transcript.v1.jsonl", startMs: 0, endMs: 1_000, itemId: "raw_1" }] }]
          : [],
      }),
    ],
    [
      "quality_report",
      writeJson("quality-report.v1.json", {
        version: 1,
        episodeId: "episode_wallaby_1",
        unsupportedClaimIds: [],
        criticFindings: [],
      }),
    ],
  ] as const;
  const artifacts = files.map(([type, absolute]) => ({
    type,
    schemaVersion: type === "attributed_transcript" ? 2 : 1,
    path: path.relative(staging, absolute).replace(/\\/g, "/"),
    bytes: statSync(absolute).size,
    sha256: sha256(readFileSync(absolute)),
  }));
  writeJson("archive-analysis-result.v1.json", {
    version: 1,
    jobId: "job_wallaby_1",
    status: "complete",
    spok: {
      missionId: "mission_wallaby_1",
      workItemId: "work_wallaby_1",
      sessionId,
      runId: "run_wallaby_3",
      capabilityFingerprint: "capability_wallaby_1",
    },
    artifacts,
  });
}

function writeJson(relative: string, value: unknown): string {
  return writeText(relative, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relative: string, value: string): string {
  const absolute = path.join(staging, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
  return absolute;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
