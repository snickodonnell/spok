import { appendFileSync, existsSync } from "fs";
import path from "path";
import type { AuditEvent } from "@/lib/settings/types";
import { redactSecrets } from "./secrets";
import { ensureSpokHome } from "@/lib/spok-paths";

function auditPath(): string {
  return path.join(ensureSpokHome(), "audit.ndjson");
}

let auditEnabled = true;

/** Toggle writing to ~/.spok/audit.ndjson (session events still separate). */
export function setAuditEnabled(enabled: boolean): void {
  auditEnabled = enabled;
}

/** Append a privileged-action audit record (never stores raw secrets). */
export function appendAuditEvent(event: AuditEvent): void {
  if (!auditEnabled) return;
  try {
    if (!existsSync(ensureSpokHome())) return;
    const safe: AuditEvent = {
      ...event,
      timestamp: event.timestamp || Date.now(),
      command: event.command
        ? redactSecrets(event.command).text
        : event.command,
      args: event.args?.map((a) => redactSecrets(a).text),
      details: event.details
        ? (JSON.parse(
            redactSecrets(JSON.stringify(event.details)).text
          ) as Record<string, unknown>)
        : undefined,
    };
    appendFileSync(auditPath(), JSON.stringify(safe) + "\n", "utf8");
  } catch {
    /* never break privileged path on audit failure */
  }
}

/** Build a StreamEvent-shaped audit payload for session event logs. */
export function auditToStreamMeta(event: AuditEvent): {
  type: "system" | "error";
  title: string;
  content: string;
  status: "success" | "error" | "skipped";
  meta: Record<string, unknown>;
  severity: "info" | "warn" | "error" | "policy" | "runtime";
} {
  const isDeny =
    event.type === "policy_denial" ||
    event.decision === "deny" ||
    event.decision === "blocked";
  const title =
    event.type === "approval_request"
      ? "Approval required"
      : event.type === "approval_decision"
        ? `Approval: ${event.decision ?? "—"}`
        : event.type === "policy_denial"
          ? "Policy denial"
          : event.type === "settings_change"
            ? "Settings changed"
            : event.type === "workspace_trust"
              ? event.action === "revoke"
                ? "Workspace trust revoked"
                : "Workspace trusted"
              : "Runtime action";

  const lines = [
    `action=${event.action}`,
    event.policy ? `policy=${event.policy}` : null,
    event.decision ? `decision=${event.decision}` : null,
    event.command ? `command=${event.command}` : null,
    event.cwd ? `cwd=${event.cwd}` : null,
    event.profile ? `profile=${event.profile}` : null,
  ].filter(Boolean);

  return {
    type: isDeny ? "error" : "system",
    title,
    content: lines.join("\n"),
    status: isDeny ? "error" : "success",
    severity: isDeny ? "policy" : "info",
    meta: {
      audit: true,
      auditType: event.type,
      ...event,
    },
  };
}
