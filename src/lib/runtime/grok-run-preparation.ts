/** Server-only compiler from prompt-bearing request to managed Grok run. */

import { buildPromptContentBlocks } from "@/lib/attachments";
import { redactSecrets } from "@/lib/security/secrets";
import { probeGrokCapabilities } from "./grok-capabilities";
import {
  createGrokPromptArtifact,
  finalizeGrokPromptArtifact,
  getGrokDebugArtifactPath,
  type GrokPromptArtifact,
} from "./grok-prompt-artifacts";
import {
  compileGrokRunSpec,
  hashGrokRunContent,
  type CompiledGrokRun,
  type GrokRunSpec,
} from "./grok-run-spec";
import { parseGrokRunRequest, type GrokRunRequest } from "./grok-run-request";
import { SPECIALIST_REPORT_JSON_SCHEMA_TEXT } from "./specialist-report";
import {
  prepareBoundedArtifactWorkflow,
  type PreparedBoundedArtifactWorkflow,
} from "./bounded-artifact-workflow";

export type PreparedGrokRun = {
  request: GrokRunRequest;
  artifact: GrokPromptArtifact;
  compiled: CompiledGrokRun;
  warnings: string[];
  workflow?: PreparedBoundedArtifactWorkflow;
};

export async function prepareGrokRun(
  input: unknown,
  hostSessionId: string
): Promise<PreparedGrokRun> {
  const request = parseGrokRunRequest(input);
  const workflow = request.workflow
    ? prepareBoundedArtifactWorkflow({
        request: request.workflow,
        cwd: request.cwd,
        hostSessionId,
        runId: request.id,
      })
    : undefined;
  const prompt = materializePrompt(request, hostSessionId, workflow);
  const artifact = createGrokPromptArtifact({
    sessionId: hostSessionId,
    runSpecId: request.id,
    content: prompt.content,
    format: prompt.format,
    ephemeral: request.debug.retention !== "handoff",
  });

  try {
    const capabilitySnapshot = await probeGrokCapabilities({
      command: request.command,
      cwd: request.cwd,
      includeLeaderHealth: !!request.execution.leaderSocket,
    });
    const output: GrokRunSpec["output"] =
      request.output.mode === "report"
        ? {
            mode: "report",
            format: "json",
            schema: SPECIALIST_REPORT_JSON_SCHEMA_TEXT,
            schemaHash: hashGrokRunContent(SPECIALIST_REPORT_JSON_SCHEMA_TEXT),
            schemaBytes: Buffer.byteLength(SPECIALIST_REPORT_JSON_SCHEMA_TEXT, "utf8"),
          }
        : { mode: "stream", format: "streaming-json" };
    const debug: GrokRunSpec["debug"] =
      request.debug.retention === "none"
        ? { retention: "none" }
        : {
            retention: request.debug.retention,
            file: getGrokDebugArtifactPath(hostSessionId, request.id),
          };
    const spec: GrokRunSpec = {
      version: 1,
      id: request.id,
      command: request.command,
      capabilitySnapshot: {
        version: capabilitySnapshot.schemaVersion,
        fingerprint: capabilitySnapshot.fingerprint,
      },
      cwd: request.cwd,
      unattended: request.unattended,
      role: request.role,
      workspace: request.workspace,
      prompt: {
        transport: "file",
        artifactId: artifact.id,
        path: artifact.path,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        ephemeral: artifact.ephemeral,
      },
      session: request.session,
      execution: request.execution,
      output,
      debug,
    };
    return {
      request,
      artifact,
      compiled: compileGrokRunSpec(spec, capabilitySnapshot),
      warnings: prompt.warnings,
      ...(workflow ? { workflow } : {}),
    };
  } catch (error) {
    try {
      finalizeGrokPromptArtifact(artifact, "cancelled");
    } catch {
      /* crash recovery will reconcile */
    }
    throw error;
  }
}

function materializePrompt(
  request: GrokRunRequest,
  hostSessionId: string,
  workflow?: PreparedBoundedArtifactWorkflow
): { content: string; format: "text" | "json"; warnings: string[] } {
  const promptText = workflow
    ? `${workflow.promptBlock}\n\nANALYTICAL POLICY AND HANDOFF CONTRACT\n\n${request.prompt.text}`
    : request.prompt.text;
  if (request.prompt.attachmentIds.length === 0) {
    return { content: promptText, format: "text", warnings: [] };
  }
  const materialized = buildPromptContentBlocks(
    hostSessionId,
    promptText,
    request.prompt.attachmentIds
  );
  return {
    content: JSON.stringify(materialized.blocks),
    format: "json",
    warnings: materialized.warnings.map((warning) => redactSecrets(warning).text),
  };
}
