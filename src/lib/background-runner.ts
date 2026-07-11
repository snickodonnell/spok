"use client";

/**
 * Client-side background job runner (Phase 5).
 * Processes the automation queue without stealing the user's foreground focus
 * unless they open the Monitor.
 */

import { useSpokStore } from "./store";
import { runHarness } from "./harness";
import { defaultGrokFlags, baseFlagsArgs } from "./grok-commands";
import {
  createJob,
  pickNextJobs,
  summarizeJobResult,
} from "./automation/queue";
import { createNotification } from "./automation/notifications";
import {
  checkAutomationPolicy,
  fetchDueSchedules,
  markScheduleRun,
} from "./automation-client";
import type { AutomationJob } from "./automation/types";
import { AUTOMATION_DEFAULTS } from "./automation/types";
import { toast } from "sonner";
import { fetchGitStatus, gitAction } from "./git/client";
import {
  establishIsolatedWorkspace,
  type IsolatedWorkspace,
} from "./automation/worktree-isolation";

const aborts = new Map<string, AbortController>();
const startingJobs = new Set<string>();
let pumping = false;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

/** Enqueue a background job and kick the pump. */
export function enqueueBackgroundJob(opts: {
  title: string;
  prompt: string;
  cwd: string;
  isolate?: boolean;
  kind?: AutomationJob["kind"];
  priority?: number;
  parentSessionId?: string;
  scheduleId?: string;
  channelId?: string;
  agentId?: string;
  activateSession?: boolean;
}): string {
  const job = createJob({
    kind: opts.kind ?? "background",
    title: opts.title,
    prompt: opts.prompt,
    cwd: opts.cwd,
    isolate: opts.isolate,
    priority: opts.priority,
    parentSessionId: opts.parentSessionId,
    scheduleId: opts.scheduleId,
    channelId: opts.channelId,
    agentId: opts.agentId,
  });

  useSpokStore.getState().enqueueJob(job);
  useSpokStore.getState().pushNotification(
    createNotification({
      kind: "info",
      title: "Queued",
      body: job.title,
      jobId: job.id,
      action: "open_monitor",
    })
  );

  void pumpQueue();
  return job.id;
}

export function cancelBackgroundJob(jobId: string): void {
  const ac = aborts.get(jobId);
  if (ac) {
    ac.abort();
    aborts.delete(jobId);
  }
  const store = useSpokStore.getState();
  const job = store.automationJobs.find((j) => j.id === jobId);
  if (!job) return;
  if (job.status === "queued") {
    store.patchJob(jobId, {
      status: "cancelled",
      finishedAt: Date.now(),
      summary: "Cancelled while queued",
    });
  } else if (job.status === "running" || job.status === "waiting_approval") {
    store.patchJob(jobId, {
      status: "cancelled",
      finishedAt: Date.now(),
      summary: "Cancelled",
    });
    if (job.sessionId) {
      void import("./local-api-client").then(({ localFetch }) =>
        localFetch(
          `/api/session/start?sessionId=${encodeURIComponent(job.sessionId!)}`,
          { method: "DELETE" }
        ).catch(() => undefined)
      );
    }
  }
  void pumpQueue();
}

async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const store = useSpokStore.getState();
    const max =
      store.automationMaxConcurrent ||
      AUTOMATION_DEFAULTS.maxConcurrentBackground;
    const next = pickNextJobs(store.automationJobs, max);
    for (const job of next) {
      void runJob(job.id);
    }
  } finally {
    pumping = false;
  }
}

async function runJob(jobId: string): Promise<void> {
  if (startingJobs.has(jobId)) return;
  startingJobs.add(jobId);

  const store = useSpokStore.getState();
  const job = store.automationJobs.find((j) => j.id === jobId);
  if (!job || job.status !== "queued") {
    startingJobs.delete(jobId);
    return;
  }

  const ac = new AbortController();
  aborts.set(jobId, ac);

  let isolatedWorkspace: IsolatedWorkspace | undefined;
  let executionCwd = job.cwd;
  let mainCheckout = job.mainCheckout;
  let worktreePath = job.worktreePath;
  let branch = job.branch;

  try {
    if (job.isolate) {
      isolatedWorkspace = await establishIsolatedWorkspace(
        {
          jobId: job.id,
          cwd: job.cwd,
          worktreePath: job.worktreePath,
          branch: job.branch,
          mainCheckout: job.mainCheckout,
        },
        {
          checkPolicy: checkAutomationPolicy,
          getStatus: (cwd) => fetchGitStatus(cwd),
          createWorktree: async (opts) =>
            gitAction({
              action: "worktree_add",
              cwd: opts.cwd,
              worktreePath: opts.worktreePath,
              branch: opts.branch,
              confirm: true,
              trustWorktree: true,
            }),
          onCreated: (created) => {
            // Keep the review handoff discoverable even if verification fails.
            useSpokStore.getState().patchJob(jobId, {
              worktreePath: created.worktreePath,
              branch: created.branch,
              mainCheckout: created.mainCheckout,
            });
          },
        }
      );
      executionCwd = isolatedWorkspace.worktreePath;
      worktreePath = isolatedWorkspace.worktreePath;
      branch = isolatedWorkspace.branch;
      mainCheckout = isolatedWorkspace.mainCheckout;
      useSpokStore.getState().patchJob(jobId, {
        worktreePath,
        branch,
        mainCheckout,
      });
    } else {
      const policy = await checkAutomationPolicy({
        cwd: job.cwd,
        requireTrusted: true,
        isolate: false,
      });
      if (!policy.ok) {
        throw new Error(policy.reason || "Automation policy denied the job");
      }
    }
  } catch (e) {
    if (!ac.signal.aborted) {
      const reason = e instanceof Error ? e.message : "Job preparation failed";
      const status = job.isolate ? "failed" : "skipped";
      store.patchJob(jobId, {
        status,
        finishedAt: Date.now(),
        error: reason,
        summary: summarizeJobResult({
          status,
          error: reason,
        }),
      });
      store.pushNotification(
        createNotification({
          kind: job.isolate ? "run_failed" : "schedule_skipped",
          title: job.isolate
            ? "Background isolation failed"
            : "Job skipped",
          body: `${job.title}: ${reason}`,
          jobId,
          action: "open_monitor",
        })
      );
      if (job.isolate) {
        toast.error("Background isolation failed", { description: reason });
      } else {
        toast.message("Background job skipped", { description: reason });
      }
      if (job.scheduleId) {
        void markScheduleRun({
          id: job.scheduleId,
          lastJobId: jobId,
          lastStatus: status,
        });
      }
    }
    aborts.delete(jobId);
    startingJobs.delete(jobId);
    void pumpQueue();
    return;
  }

  if (ac.signal.aborted) {
    aborts.delete(jobId);
    startingJobs.delete(jobId);
    void pumpQueue();
    return;
  }

  // Create session without stealing focus
  const sessionId = store.createSession(
    {
      name: `BG · ${job.title}`.slice(0, 64),
      source: "live",
      status: "ready",
      backgroundJob: true,
      config: {
        cwd: executionCwd,
        command: "grok",
        args: [],
        autoScroll: true,
        playbackSpeed: 1,
        isolationGuard: job.isolate,
        mainCheckout,
        worktreePath,
      },
      gitSummary: isolatedWorkspace
        ? {
            branch: isolatedWorkspace.status.branch.current || branch || null,
            upstream: isolatedWorkspace.status.branch.upstream,
            ahead: isolatedWorkspace.status.branch.ahead,
            behind: isolatedWorkspace.status.branch.behind,
            stagedCount: isolatedWorkspace.status.stagedCount,
            unstagedCount: isolatedWorkspace.status.unstagedCount,
            untrackedCount: isolatedWorkspace.status.untrackedCount,
            conflictCount: isolatedWorkspace.status.conflictCount,
            clean: isolatedWorkspace.status.clean,
            isWorktree: true,
            mainWorktreePath: mainCheckout || null,
            repoRoot: executionCwd,
            headOid: isolatedWorkspace.status.branch.headOid,
            updatedAt: isolatedWorkspace.status.timestamp,
          }
        : undefined,
    },
    { activate: false }
  );

  store.applyStreamEvent(sessionId, {
    type: "system",
    timestamp: Date.now(),
    title: "Background job",
    content: [
      `Title: ${job.title}`,
      `Kind: ${job.kind}`,
      `cwd: ${executionCwd}`,
      job.isolate
        ? `Isolation: active${branch ? ` · ${branch}` : ""}`
        : "Isolation: off",
      "",
      job.prompt.slice(0, 2000),
    ].join("\n"),
    status: "running",
    provider: "spok",
    meta: { backgroundJob: true, jobId },
  });

  store.patchJob(jobId, {
    status: "running",
    startedAt: Date.now(),
    sessionId,
  });

  const flags = defaultGrokFlags();
  const args = [...baseFlagsArgs(flags), "-p", job.prompt];

  try {
    const result = await runHarness({
      sessionId,
      cwd: executionCwd,
      command: "grok",
      args,
      label: job.title,
      signal: ac.signal,
    });

    const session = useSpokStore.getState().sessions[sessionId];
    const failed =
      result.code != null && result.code !== 0
        ? true
        : session?.status === "error";

    const status = ac.signal.aborted
      ? ("cancelled" as const)
      : failed
        ? ("failed" as const)
        : ("completed" as const);

    const summary = summarizeJobResult({
      status,
      exitCode: result.code,
      error: session?.error,
      filesChanged: session?.metrics.filesChanged,
      toolCalls: session?.metrics.toolCallCount,
    });

    useSpokStore.getState().patchJob(jobId, {
      status,
      finishedAt: Date.now(),
      exitCode: result.code,
      summary,
      error: failed ? session?.error : undefined,
    });

    // Merge subagent summary into session if lanes exist
    if (session) {
      const { extractSubagentLanes, mergeSubagentSummaries } = await import(
        "./automation/subagent-lanes"
      );
      const lanes = extractSubagentLanes(session.nodes);
      if (lanes.length) {
        const merged = mergeSubagentSummaries(lanes);
        useSpokStore.getState().applyStreamEvent(sessionId, {
          type: "system",
          timestamp: Date.now(),
          title: "Subagent lanes summary",
          content: merged,
          status: "success",
          provider: "spok",
          meta: { subagentSummary: true, laneCount: lanes.length },
        });
        useSpokStore.getState().setSessionSubagentLanes(sessionId, lanes);
      }
    }

    useSpokStore.getState().pushNotification(
      createNotification({
        kind:
          status === "completed"
            ? "run_complete"
            : status === "cancelled"
              ? "run_cancelled"
              : "run_failed",
        title:
          status === "completed"
            ? "Background job finished"
            : status === "cancelled"
              ? "Background job cancelled"
              : "Background job failed",
        body: `${job.title} — ${summary}`,
        jobId,
        sessionId,
        action: "open_session",
      })
    );

    if (status === "completed") {
      toast.success("Background job done", { description: job.title });
    } else if (status === "failed") {
      toast.error("Background job failed", { description: job.title });
    }

    if (job.scheduleId) {
      void markScheduleRun({
        id: job.scheduleId,
        lastJobId: jobId,
        lastStatus: status,
      });
    }
  } catch (e) {
    if (ac.signal.aborted) {
      useSpokStore.getState().patchJob(jobId, {
        status: "cancelled",
        finishedAt: Date.now(),
        summary: "Cancelled",
      });
    } else {
      const message = e instanceof Error ? e.message : "Job failed";
      useSpokStore.getState().patchJob(jobId, {
        status: "failed",
        finishedAt: Date.now(),
        error: message,
        summary: message,
      });
      useSpokStore.getState().pushNotification(
        createNotification({
          kind: "run_failed",
          title: "Background job failed",
          body: `${job.title}: ${message}`,
          jobId,
          sessionId,
          action: "open_session",
        })
      );
      toast.error("Background job failed", { description: message });
      if (job.scheduleId) {
        void markScheduleRun({
          id: job.scheduleId,
          lastJobId: jobId,
          lastStatus: "failed",
        });
      }
    }
  } finally {
    aborts.delete(jobId);
    startingJobs.delete(jobId);
    void pumpQueue();
  }
}

/** Poll due schedules and enqueue jobs (call while app is open). */
export async function tickSchedules(): Promise<number> {
  try {
    const due = await fetchDueSchedules();
    let n = 0;
    for (const s of due) {
      if (!s.policy?.ok) {
        useSpokStore.getState().pushNotification(
          createNotification({
            kind: "schedule_skipped",
            title: "Schedule skipped",
            body: `${s.name}: ${s.policy?.reason || "policy denied"}`,
            scheduleId: s.id,
            action: "open_monitor",
          })
        );
        void markScheduleRun({
          id: s.id,
          lastStatus: "skipped",
        });
        continue;
      }
      enqueueBackgroundJob({
        title: `Schedule · ${s.name}`,
        prompt: s.prompt,
        cwd: s.cwd,
        isolate: s.isolate,
        kind: "scheduled",
        scheduleId: s.id,
        priority: 1,
      });
      useSpokStore.getState().pushNotification(
        createNotification({
          kind: "schedule_fired",
          title: "Schedule fired",
          body: s.name,
          scheduleId: s.id,
          action: "open_monitor",
        })
      );
      // Mark run immediately so nextRunAt advances (job may still be queued)
      void markScheduleRun({
        id: s.id,
        lastStatus: "queued",
      });
      n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

export function startScheduleTicker(): () => void {
  if (scheduleTimer) clearInterval(scheduleTimer);
  // Initial delay so hydration/trust can settle
  const boot = setTimeout(() => {
    void tickSchedules();
  }, 5000);
  scheduleTimer = setInterval(() => {
    void tickSchedules();
  }, AUTOMATION_DEFAULTS.scheduleTickMs);
  return () => {
    clearTimeout(boot);
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = null;
  };
}

/** Keep pumping when jobs change — called from a React effect. */
export function ensureQueuePump(): void {
  void pumpQueue();
}
