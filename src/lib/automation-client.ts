"use client";

import { localFetch } from "./local-api-client";
import type {
  ChannelDefinition,
  ChannelEventRecord,
  ScheduleDefinition,
  AutomationJob,
} from "./automation/types";

export type AutomationBundleResponse = {
  schedules: ScheduleDefinition[];
  channels: Array<
    Omit<ChannelDefinition, "secret"> & {
      secretPreview?: string;
      secret?: string;
    }
  >;
  recentChannelEvents: ChannelEventRecord[];
  trustedRoots: string[];
  policy: {
    requireTrustedDefault: boolean;
    maxConcurrentBackground: number;
    maxSchedules: number;
    maxChannels: number;
  };
};

export type AutomationJobsResponse = {
  version: 1;
  jobs: AutomationJob[];
  reconciled: number;
  discarded: number;
  corrupt: boolean;
};

async function automationJobError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  return new Error(body.error || `${fallback} (${res.status})`);
}

/** Boot-only durable ledger load. The server performs restart reconciliation. */
export async function fetchAutomationJobs(): Promise<AutomationJobsResponse> {
  const res = await localFetch("/api/automation/jobs", { cache: "no-store" });
  if (!res.ok) throw await automationJobError(res, "Failed to load automation jobs");
  return (await res.json()) as AutomationJobsResponse;
}

/** Persist one newly queued job before it becomes eligible to execute. */
export async function saveAutomationJob(job: AutomationJob): Promise<AutomationJob> {
  const res = await localFetch("/api/automation/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job }),
  });
  if (!res.ok) throw await automationJobError(res, "Failed to persist automation job");
  const body = (await res.json()) as { job: AutomationJob };
  return body.job;
}

/** Debounced ledger snapshot for transitions, linkage changes, and removals. */
export async function replaceAutomationJobs(
  jobs: AutomationJob[]
): Promise<AutomationJob[]> {
  const res = await localFetch("/api/automation/jobs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs }),
  });
  if (!res.ok) throw await automationJobError(res, "Failed to persist job ledger");
  const body = (await res.json()) as { jobs: AutomationJob[] };
  return body.jobs;
}

export async function fetchAutomationBundle(): Promise<AutomationBundleResponse> {
  const res = await localFetch("/api/automation");
  if (!res.ok) throw new Error(`Failed to load automation (${res.status})`);
  return (await res.json()) as AutomationBundleResponse;
}

export async function fetchDueSchedules(): Promise<
  Array<ScheduleDefinition & { policy: { ok: boolean; reason: string; code?: string } }>
> {
  const res = await localFetch("/api/automation/schedules?due=1");
  if (!res.ok) throw new Error(`Failed to load due schedules (${res.status})`);
  const data = (await res.json()) as {
    schedules: Array<
      ScheduleDefinition & {
        policy: { ok: boolean; reason: string; code?: string };
      }
    >;
  };
  return data.schedules;
}

export async function saveSchedule(
  schedule: Partial<ScheduleDefinition> & {
    name: string;
    cwd: string;
    prompt: string;
  }
): Promise<ScheduleDefinition> {
  const res = await localFetch("/api/automation/schedules", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(schedule),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Save schedule failed (${res.status})`);
  }
  const data = (await res.json()) as { schedule: ScheduleDefinition };
  return data.schedule;
}

export async function removeSchedule(id: string): Promise<void> {
  const res = await localFetch(
    `/api/automation/schedules?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`Delete schedule failed (${res.status})`);
}

export async function markScheduleRun(opts: {
  id: string;
  lastJobId?: string;
  lastStatus?: string;
}): Promise<void> {
  await localFetch("/api/automation/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark_run", ...opts }),
  });
}

export async function saveChannel(
  channel: Partial<ChannelDefinition> & { name: string; cwd: string }
): Promise<ChannelDefinition & { secret?: string; secretPreview?: string }> {
  const res = await localFetch("/api/automation/channels", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(channel),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Save channel failed (${res.status})`);
  }
  const data = (await res.json()) as {
    channel: ChannelDefinition & { secret?: string; secretPreview?: string };
  };
  return data.channel;
}

export async function removeChannel(id: string): Promise<void> {
  const res = await localFetch(
    `/api/automation/channels?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(`Delete channel failed (${res.status})`);
}

export async function checkAutomationPolicy(opts: {
  cwd: string;
  requireTrusted?: boolean;
  isolate?: boolean;
  mainCheckout?: string;
}): Promise<{ ok: boolean; reason: string; code?: string }> {
  const res = await localFetch("/api/automation/policy-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    return { ok: false, reason: `Policy check failed (${res.status})` };
  }
  return (await res.json()) as {
    ok: boolean;
    reason: string;
    code?: string;
  };
}

export async function ingestChannelEvent(opts: {
  channelId: string;
  secret: string;
  title?: string;
  payload?: string;
}): Promise<{
  ok: boolean;
  jobBlueprint?: {
    kind: "channel";
    title: string;
    prompt: string;
    cwd: string;
    isolate: boolean;
    channelId: string;
    targetMode: string;
  } | null;
  notify?: { title: string; body: string };
  error?: string;
}> {
  const res = await localFetch("/api/automation/channels/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-spok-channel-secret": opts.secret,
    },
    body: JSON.stringify({
      channelId: opts.channelId,
      title: opts.title,
      payload: opts.payload,
      secret: opts.secret,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    jobBlueprint?: {
      kind: "channel";
      title: string;
      prompt: string;
      cwd: string;
      isolate: boolean;
      channelId: string;
      targetMode: string;
    } | null;
    notify?: { title: string; body: string };
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `Ingest failed (${res.status})` };
  }
  return {
    ok: true,
    jobBlueprint: data.jobBlueprint,
    notify: data.notify,
  };
}

/** Helper type re-export for UI */
export type { AutomationJob, ScheduleDefinition, ChannelDefinition };
