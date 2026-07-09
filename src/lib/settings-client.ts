"use client";

import { localFetch } from "./local-api-client";
import type {
  ApprovalDecision,
  ApprovalGrant,
  ApprovalRequest,
  LayeredSettingsBundle,
  SpokSettings,
  CommandProfile,
} from "./settings/types";
import { defaultSettings, PERMISSION_MODE_META } from "./settings/defaults";
import { createNotification } from "./automation/notifications";

export type SettingsResponse = LayeredSettingsBundle & {
  profiles: CommandProfile[];
  permissionModeMeta: typeof PERMISSION_MODE_META;
  grants: ApprovalGrant[];
};

let cached: SettingsResponse | null = null;

export async function fetchSettings(cwd?: string): Promise<SettingsResponse> {
  const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const res = await localFetch(`/api/settings${q}`);
  if (!res.ok) {
    throw new Error(`Failed to load settings (${res.status})`);
  }
  const data = (await res.json()) as SettingsResponse;
  cached = data;
  return data;
}

export function getCachedSettings(): SettingsResponse | null {
  return cached;
}

export async function saveSettings(opts: {
  layer: "user" | "project";
  settings: Partial<SpokSettings>;
  cwd?: string;
  reset?: boolean;
}): Promise<SettingsResponse> {
  const res = await localFetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Save settings failed (${res.status})`);
  }
  await res.json().catch(() => undefined);
  return fetchSettings(opts.cwd);
}

export async function submitApprovalDecision(
  requestId: string,
  decision: ApprovalDecision
): Promise<{ onceToken?: string; grant?: ApprovalGrant }> {
  const res = await localFetch("/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, decision }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Approval failed (${res.status})`);
  }
  return (await res.json()) as { onceToken?: string; grant?: ApprovalGrant };
}

export async function revokeApprovalGrant(id: string): Promise<void> {
  const res = await localFetch(`/api/approvals?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Revoke grant failed (${res.status})`);
  }
}

export async function clearAllApprovalGrants(): Promise<void> {
  const res = await localFetch("/api/approvals?all=1", { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Clear grants failed (${res.status})`);
  }
}

export function fallbackSettings(): SpokSettings {
  return defaultSettings();
}

/** Global approval waiter used by harness when server returns approval_required. */
type ApprovalWaiter = {
  request: ApprovalRequest;
  resolve: (result: { decision: ApprovalDecision; onceToken?: string }) => void;
  reject: (err: Error) => void;
  settled: boolean;
};

let waiter: ApprovalWaiter | null = null;
const listeners = new Set<(w: ApprovalWaiter | null) => void>();

export function subscribeApprovalWaiter(
  fn: (w: ApprovalWaiter | null) => void
): () => void {
  listeners.add(fn);
  fn(waiter);
  return () => listeners.delete(fn);
}

function emitWaiter() {
  for (const fn of listeners) fn(waiter);
}

/**
 * Show approval overlay and wait for user decision.
 * Only one pending approval at a time.
 */
export function requestUserApproval(
  request: ApprovalRequest
): Promise<{ decision: ApprovalDecision; onceToken?: string }> {
  if (waiter && !waiter.settled) {
    waiter.settled = true;
    waiter.reject(new Error("Superseded by another approval request"));
    waiter = null;
  }
  return new Promise((resolve, reject) => {
    waiter = {
      request,
      resolve,
      reject,
      settled: false,
    };
    emitWaiter();
    // Phase 5: surface approval in notification center (lazy store import avoids cycles)
    void import("./store")
      .then(({ useSpokStore }) => {
        useSpokStore.getState().pushNotification(
          createNotification({
            kind: "approval_needed",
            title: "Approval needed",
            body: request.reason || request.preview.slice(0, 160),
            sessionId: request.sessionId,
            action: "open_approvals",
          })
        );
      })
      .catch(() => undefined);
  });
}

function takeWaiter(): ApprovalWaiter | null {
  const current = waiter;
  if (!current || current.settled) return null;
  current.settled = true;
  waiter = null;
  emitWaiter();
  return current;
}

export async function completeUserApproval(
  decision: ApprovalDecision
): Promise<void> {
  const current = takeWaiter();
  if (!current) return;

  try {
    if (decision === "deny") {
      await submitApprovalDecision(current.request.id, "deny").catch(
        () => undefined
      );
      current.resolve({ decision: "deny" });
      return;
    }

    const result = await submitApprovalDecision(current.request.id, decision);
    if (!result.onceToken) {
      current.reject(
        new Error("Server did not return an approval token for retry")
      );
      return;
    }
    current.resolve({
      decision,
      onceToken: result.onceToken,
    });
  } catch (e) {
    current.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

export function cancelUserApproval(): void {
  const current = takeWaiter();
  if (!current) return;
  void submitApprovalDecision(current.request.id, "deny").catch(() => undefined);
  current.resolve({ decision: "deny" });
}

export function getApprovalWaiter(): ApprovalWaiter | null {
  return waiter;
}
