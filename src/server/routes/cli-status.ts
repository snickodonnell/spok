// Shared privileged handler (Track A extraction).
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import { appendAuditEvent } from "@/lib/security/audit";
import {
  CLI_AUTH_GUIDANCE,
  probeCliStatus,
  type CliStatus,
} from "@/lib/runtime/cli-status";
import {
  checkGrokCompatibility,
  isGrokCapabilityId,
  probeGrokCapabilities,
  type GrokCapabilityId,
  type GrokCapabilitySnapshot,
} from "@/lib/runtime/grok-capabilities";


/**
 * GET /api/runtime/cli-status?command=grok
 * Presence + version probe by default. `capabilities=1` adds the versioned,
 * sanitized Grok capability snapshot; `required=a,b` evaluates the launch gate.
 * Does not claim Grok login state because `inspect --json` does not expose it.
 */
export async function handleCliStatusGet(req: Request) {
  const auth = authorizePrivilegedRequest(req, "cli_status");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const configuredCommand = process.env.SPOK_GROK_CMD?.trim() || "grok";
  const command =
    searchParams.get("command")?.trim() ||
    configuredCommand;

  const requiredValues = (searchParams.get("required") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const invalidRequired = requiredValues.filter(
    (value) => !isGrokCapabilityId(value)
  );
  if (invalidRequired.length > 0) {
    return Response.json(
      {
        error: `Unknown Grok capability id: ${invalidRequired.join(", ")}`,
        code: "invalid_capability_requirement",
      },
      { status: 400 }
    );
  }
  const required = requiredValues as GrokCapabilityId[];
  const includeLeaderHealth = searchParams.get("leader") === "1";
  const wantsCapabilities =
    searchParams.get("capabilities") === "1" ||
    includeLeaderHealth ||
    required.length > 0;

  if (!wantsCapabilities) {
    const status = await probeCliStatus(command);
    return Response.json({
      ok: status.found,
      status,
      authModel: "external_cli",
    });
  }

  // Detailed discovery executes Grok-specific subcommands. Never turn this
  // privileged route into an arbitrary executable inspection surface.
  if (command.toLowerCase() !== configuredCommand.toLowerCase()) {
    return policyDenialResponse(403, {
      error: "Detailed capability discovery is limited to the configured Grok CLI",
      code: "command_not_allowed",
      policy: "command_profile",
      action: "cli_capability_probe",
      details: { command },
    });
  }

  const trust = requireTrustedCwd(searchParams.get("cwd")?.trim() || process.cwd());
  if (!trust.ok) {
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "cli_capability_probe",
      details: { cwd: trust.path },
    });
  }

  const snapshot = await probeGrokCapabilities({
    command,
    cwd: trust.path,
    includeLeaderHealth,
  });
  const effectiveRequired = [
    ...new Set<GrokCapabilityId>([
      "inspect_json",
      ...required,
      ...(includeLeaderHealth ? (["leader_health_json"] as const) : []),
    ]),
  ];
  const compatibility = checkGrokCompatibility(snapshot, effectiveRequired);
  const status = statusFromSnapshot(snapshot);

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    action: "cli_capability_probe",
    cwd: trust.path,
    command,
    profile: "grok",
    policy: "grok_capability_preflight",
    decision: compatibility.ok ? "allowed" : "blocked",
    details: {
      snapshotVersion: snapshot.schemaVersion,
      snapshotFingerprint: snapshot.fingerprint,
      required: compatibility.required,
      unsupported: compatibility.unsupported,
      unknown: compatibility.unknown,
      leaderHealth: snapshot.leader.status,
    },
  });

  return Response.json({
    ok: compatibility.ok,
    status,
    snapshot,
    compatibility,
    /**
     * Explicit product contract: Spok never owns Grok OAuth/API-key login.
     * Users authenticate with the native CLI before launching Spok.
     */
    authModel: "external_cli",
  });
}

function statusFromSnapshot(snapshot: GrokCapabilitySnapshot): CliStatus {
  return {
    command: snapshot.command,
    found: snapshot.binary.found,
    version: snapshot.binary.version,
    // Raw version/help/inspect output intentionally stays outside API state.
    versionRaw: null,
    probeMs: snapshot.probeMs,
    platform: process.platform,
    authChecked: false,
    authGuidance: CLI_AUTH_GUIDANCE,
    ...(snapshot.binary.found ? {} : { error: "not_found" }),
  };
}
