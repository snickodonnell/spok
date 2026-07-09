import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";
import type {
  ApprovalDecision,
  ApprovalGrant,
  ApprovalRequest,
} from "@/lib/settings/types";
import { actionFingerprint } from "./permission-policy";
import { ensureSpokHome } from "@/lib/spok-paths";

function approvalsPath(): string {
  return path.join(ensureSpokHome(), "approvals.json");
}

/** In-process pending requests awaiting UI decision */
const pending = new Map<string, ApprovalRequest>();

/** One-shot tokens issued after allow (consumed on successful use) */
const onceTokens = new Map<
  string,
  { fingerprint: string; fingerprintLoose: string; expiresAt: number }
>();

function loadGrants(): ApprovalGrant[] {
  const file = approvalsPath();
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      grants?: ApprovalGrant[];
    };
    const now = Date.now();
    return (raw.grants ?? []).filter((g) => !g.expiresAt || g.expiresAt > now);
  } catch {
    return [];
  }
}

function saveGrants(grants: ApprovalGrant[]): void {
  const file = approvalsPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify({ version: 1, grants }, null, 2);
  writeFileSync(tmp, body, "utf8");
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, body, "utf8");
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function listApprovalGrants(): ApprovalGrant[] {
  return loadGrants();
}

export function clearApprovalGrants(): void {
  saveGrants([]);
}

export function createApprovalRequest(
  partial: Omit<ApprovalRequest, "id" | "timestamp">
): ApprovalRequest {
  const req: ApprovalRequest = {
    ...partial,
    id: randomBytes(12).toString("hex"),
    timestamp: Date.now(),
  };
  pending.set(req.id, req);
  // expire stale pending after 10 minutes
  const t = setTimeout(() => pending.delete(req.id), 10 * 60 * 1000);
  if (typeof t === "object" && "unref" in t) {
    (t as NodeJS.Timeout).unref();
  }
  return req;
}

export function getPendingApproval(id: string): ApprovalRequest | undefined {
  return pending.get(id);
}

function fingerprintsFor(req: ApprovalRequest): {
  exact: string;
  loose: string;
} {
  const base = {
    action: req.action,
    command: req.command,
    args: req.args,
    cwd: req.cwd,
  };
  return {
    exact: actionFingerprint(base, { includeArgs: true }),
    loose: actionFingerprint(base, { includeArgs: false }),
  };
}

function issueOnceToken(exact: string, loose: string): string {
  const onceToken = randomBytes(16).toString("base64url");
  onceTokens.set(onceToken, {
    fingerprint: exact,
    fingerprintLoose: loose,
    expiresAt: Date.now() + 2 * 60 * 1000,
  });
  return onceToken;
}

export function decideApproval(
  requestId: string,
  decision: ApprovalDecision
): {
  ok: boolean;
  grant?: ApprovalGrant;
  onceToken?: string;
  error?: string;
} {
  const req = pending.get(requestId);
  if (!req) {
    return { ok: false, error: "Approval request not found or expired" };
  }
  pending.delete(requestId);

  if (decision === "deny") {
    return { ok: true };
  }

  const { exact, loose } = fingerprintsFor(req);
  // Always issue a one-shot token so the immediate retry is reliable
  // even if disk grants lag or args differ slightly.
  const onceToken = issueOnceToken(exact, loose);

  if (decision === "allow_once") {
    const grant: ApprovalGrant = {
      id: randomBytes(8).toString("hex"),
      fingerprint: exact,
      decision: "allow_once",
      createdAt: Date.now(),
      cwd: req.cwd,
      command: req.command,
      profile: req.profile,
      action: req.action,
      expiresAt: Date.now() + 2 * 60 * 1000,
    };
    return { ok: true, grant, onceToken };
  }

  // allow_always — persist using loose fingerprint (command+cwd, any args)
  const grant: ApprovalGrant = {
    id: randomBytes(8).toString("hex"),
    fingerprint: loose,
    decision: "allow_always",
    createdAt: Date.now(),
    cwd: req.cwd,
    command: req.command,
    profile: req.profile,
    action: req.action,
  };
  const grants = loadGrants().filter((g) => {
    if (g.action !== grant.action) return true;
    if (!g.command || !grant.command) return true;
    const sameCmd =
      g.command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ===
      grant.command.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
    const sameCwd =
      !g.cwd ||
      !grant.cwd ||
      g.cwd.replace(/\\/g, "/").toLowerCase() ===
        grant.cwd.replace(/\\/g, "/").toLowerCase();
    // Drop previous always-grant for same command+cwd
    return !(sameCmd && sameCwd && g.decision === "allow_always");
  });
  grants.push(grant);
  saveGrants(grants);
  return { ok: true, grant, onceToken };
}

/**
 * Consume a one-shot token only if it matches the request fingerprint.
 * Mismatched tokens are left intact (not stolen by a different command).
 */
export function consumeOnceToken(
  token: string | undefined,
  expected: { action: string; command?: string; args?: string[]; cwd?: string }
): { fingerprint: string } | null {
  if (!token) return null;
  const entry = onceTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    onceTokens.delete(token);
    return null;
  }

  const exact = actionFingerprint(
    {
      action: expected.action as ApprovalRequest["action"],
      command: expected.command,
      args: expected.args,
      cwd: expected.cwd,
    },
    { includeArgs: true }
  );
  const loose = actionFingerprint(
    {
      action: expected.action as ApprovalRequest["action"],
      command: expected.command,
      args: expected.args,
      cwd: expected.cwd,
    },
    { includeArgs: false }
  );

  if (
    entry.fingerprint !== exact &&
    entry.fingerprintLoose !== loose &&
    entry.fingerprint !== loose
  ) {
    // Token is for a different action — do not consume
    return null;
  }

  onceTokens.delete(token);
  return { fingerprint: exact };
}

export function getActiveGrants(): ApprovalGrant[] {
  return loadGrants();
}

export function revokeGrant(id: string): boolean {
  const grants = loadGrants();
  const next = grants.filter((g) => g.id !== id);
  if (next.length === grants.length) return false;
  saveGrants(next);
  return true;
}
