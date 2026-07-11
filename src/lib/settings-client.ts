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

/** Pending client waiter used when a harness run returns approval_required. */
type ApprovalWaiter = {
  request: ApprovalRequest;
  resolve: (result: { decision: ApprovalDecision; onceToken?: string }) => void;
  reject: (err: Error) => void;
  settled: boolean;
  abortCleanup?: () => void;
};

export type ApprovalQueueSnapshot = {
  requests: ApprovalRequest[];
  activeRequestId: string | null;
};

const waiters: ApprovalWaiter[] = [];
const listeners = new Set<(w: ApprovalWaiter | null) => void>();
const queueListeners = new Set<(snapshot: ApprovalQueueSnapshot) => void>();

function activeWaiter(): ApprovalWaiter | null {
  return waiters.find((candidate) => !candidate.settled) ?? null;
}

function queueSnapshot(): ApprovalQueueSnapshot {
  const requests = waiters
    .filter((candidate) => !candidate.settled)
    .map((candidate) => candidate.request);
  return {
    requests,
    activeRequestId: requests[0]?.id ?? null,
  };
}

export function subscribeApprovalWaiter(
  fn: (w: ApprovalWaiter | null) => void
): () => void {
  listeners.add(fn);
  fn(activeWaiter());
  return () => listeners.delete(fn);
}

/** Subscribe to every in-process approval currently blocking a harness run. */
export function subscribeApprovalQueue(
  fn: (snapshot: ApprovalQueueSnapshot) => void
): () => void {
  queueListeners.add(fn);
  fn(queueSnapshot());
  return () => queueListeners.delete(fn);
}

function emitApprovalState() {
  const active = activeWaiter();
  for (const fn of listeners) fn(active);
  const snapshot = queueSnapshot();
  for (const fn of queueListeners) fn(snapshot);
}

/**
 * Queue an approval and wait for the matching user decision.
 * Concurrent sessions remain independent; a later request never supersedes an
 * earlier waiter or inherits its decision/token.
 */
export function requestUserApproval(
  request: ApprovalRequest,
  signal?: AbortSignal
): Promise<{ decision: ApprovalDecision; onceToken?: string }> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Approval interrupted", "AbortError"));
  }
  const existing = waiters.find(
    (candidate) => !candidate.settled && candidate.request.id === request.id
  );
  if (existing) {
    return Promise.reject(
      new Error(`Approval request ${request.id} is already waiting`)
    );
  }

  return new Promise((resolve, reject) => {
    const next: ApprovalWaiter = {
      request,
      resolve,
      reject,
      settled: false,
    };
    if (signal) {
      const onAbort = () => {
        const current = takeWaiter(request.id);
        if (!current) return;
        void submitApprovalDecision(request.id, "deny").catch(() => undefined);
        current.reject(new DOMException("Approval interrupted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      next.abortCleanup = () => signal.removeEventListener("abort", onAbort);
    }
    waiters.push(next);
    emitApprovalState();
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

function takeWaiter(requestId?: string): ApprovalWaiter | null {
  const index = requestId
    ? waiters.findIndex(
        (candidate) =>
          !candidate.settled && candidate.request.id === requestId
      )
    : waiters.findIndex((candidate) => !candidate.settled);
  if (index < 0) return null;
  const [current] = waiters.splice(index, 1);
  current.settled = true;
  current.abortCleanup?.();
  emitApprovalState();
  return current;
}

export async function completeUserApproval(
  decision: ApprovalDecision,
  requestId?: string
): Promise<void> {
  const current = takeWaiter(requestId);
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

export function cancelUserApproval(requestId?: string): void {
  const current = takeWaiter(requestId);
  if (!current) return;
  void submitApprovalDecision(current.request.id, "deny").catch(() => undefined);
  current.resolve({ decision: "deny" });
}

export function getApprovalWaiter(): ApprovalWaiter | null {
  return activeWaiter();
}

export function getApprovalQueue(): ApprovalRequest[] {
  return queueSnapshot().requests;
}
