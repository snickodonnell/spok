"use client";

import {
  cancelBackgroundJob,
  enqueueBackgroundJob,
} from "./background-runner";
import {
  cloneJobBlueprint,
  getJobActionAvailability,
  type InboxJobAction,
} from "./automation/job-actions";
import { useSpokStore } from "./store";

export type InboxActionResult =
  | { ok: true; message: string; jobId?: string }
  | { ok: false; message: string };

/** Narrow client mutation boundary for inbox fleet controls. */
export function performInboxJobAction(
  jobId: string,
  action: InboxJobAction
): InboxActionResult {
  const store = useSpokStore.getState();
  const job = store.automationJobs.find((candidate) => candidate.id === jobId);
  if (!job) return { ok: false, message: "Background job no longer exists." };

  const availability = getJobActionAvailability(job.status);
  if (!availability[action]) {
    return {
      ok: false,
      message: `This action is no longer available while the job is ${job.status.replace(/_/g, " ")}.`,
    };
  }

  if (action === "cancel") {
    cancelBackgroundJob(job.id);
    return {
      ok: true,
      message:
        job.status === "running"
          ? "Stop requested"
          : job.status === "waiting_approval"
            ? "Job cancelled"
            : "Queued job cancelled",
    };
  }

  if (action === "priority_up" || action === "priority_down") {
    const priority = job.priority + (action === "priority_up" ? 1 : -1);
    store.patchJob(job.id, { priority });
    return { ok: true, message: `Queue priority ${priority}` };
  }

  const cloned = cloneJobBlueprint(job, action);
  if (!cloned.ok) return { ok: false, message: cloned.reason };
  const nextJobId = enqueueBackgroundJob(cloned.blueprint);
  return {
    ok: true,
    message: action === "retry" ? "Retry queued" : "Copy queued",
    jobId: nextJobId,
  };
}

