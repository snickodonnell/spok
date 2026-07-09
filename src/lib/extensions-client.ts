"use client";

import { localFetch } from "./local-api-client";
import type {
  ExtensionsBundle,
  ExtensionPreferences,
  HookEvent,
  HookRunResult,
  SkillDescriptor,
} from "./extensions/types";

export type ExtensionsResponse = ExtensionsBundle;

export async function fetchExtensions(
  cwd?: string
): Promise<ExtensionsResponse> {
  const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const res = await localFetch(`/api/extensions${q}`);
  if (!res.ok) {
    throw new Error(`Failed to load extensions (${res.status})`);
  }
  return (await res.json()) as ExtensionsResponse;
}

export async function saveExtensionPreferences(opts: {
  layer: "user" | "project";
  cwd?: string;
  preferences: Partial<ExtensionPreferences>;
  replace?: boolean;
}): Promise<ExtensionsResponse> {
  const res = await localFetch("/api/extensions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Save extensions failed (${res.status})`);
  }
  return (await res.json()) as ExtensionsResponse;
}

export async function fetchSkillDetail(
  id: string,
  cwd?: string,
  body = true
): Promise<{
  skill: SkillDescriptor;
  body?: string;
  truncated?: boolean;
}> {
  const params = new URLSearchParams({ id });
  if (cwd) params.set("cwd", cwd);
  if (body) params.set("body", "1");
  const res = await localFetch(`/api/extensions/skills?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Skill load failed (${res.status})`);
  }
  return (await res.json()) as {
    skill: SkillDescriptor;
    body?: string;
    truncated?: boolean;
  };
}

export async function runSessionHooks(opts: {
  event: HookEvent;
  sessionId: string;
  cwd?: string;
  vars?: Record<string, string>;
  hookIds?: string[];
}): Promise<{ results: HookRunResult[]; eventCount: number }> {
  const res = await localFetch("/api/extensions/hooks/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Hook run failed (${res.status})`);
  }
  return (await res.json()) as {
    results: HookRunResult[];
    eventCount: number;
  };
}

/** Apply hook run results into the active session store. */
export function applyHookResultsToSession(
  sessionId: string,
  results: HookRunResult[],
  applyStreamEvent: (
    sessionId: string,
    event: {
      type: "system" | "error" | "message";
      timestamp: number;
      title: string;
      content: string;
      status: "success" | "error" | "skipped" | "pending";
      meta?: Record<string, unknown>;
      provider?: "spok";
      severity?: "info" | "warn" | "error" | "policy" | "runtime";
    }
  ) => void
): number {
  let n = 0;
  for (const r of results) {
    for (const ev of r.events) {
      applyStreamEvent(sessionId, {
        type: ev.type,
        timestamp: Date.now(),
        title: ev.title,
        content: ev.content,
        status: ev.status,
        meta: ev.meta,
        provider: "spok",
        severity: ev.type === "error" ? "error" : "info",
      });
      n += 1;
    }
  }
  return n;
}
