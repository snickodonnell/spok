"use client";

import { useSpokStore } from "./store";
import { GrokStreamIngestor } from "./grok-stream";
import { localFetch } from "./local-api-client";
import { redactSecrets } from "./security/secrets";
import { requestUserApproval } from "./settings-client";
import type { ApprovalRequest } from "./settings/types";
import {
  applyHookResultsToSession,
  runSessionHooks,
} from "./extensions-client";
import { detectAuthFailureHint } from "./runtime/auth-hints";

export type HarnessHandle = {
  sessionId: string;
  abort: () => void;
};

/**
 * Stream a Grok CLI invocation into a Spok session.
 * Deserializes Grok streaming-json / ACP session updates into friendly traces.
 * Handles policy denials and interactive approval for custom/high-risk commands.
 */
export async function runHarness(opts: {
  sessionId: string;
  cwd: string;
  command?: string;
  args: string[];
  label?: string;
  signal?: AbortSignal;
}): Promise<{ code: number | null }> {
  const { sessionId, cwd, args, label } = opts;
  const command = opts.command || "grok";
  const store = useSpokStore.getState();
  const ingest = new GrokStreamIngestor(cwd);

  store.updateSession(sessionId, { status: "starting", error: undefined });
  store.applyStreamEvent(sessionId, {
    type: "system",
    timestamp: Date.now(),
    title: "Run",
    content: label
      ? `${label}\n$ ${command} ${args.map(shellQuote).join(" ")}`
      : `$ ${command} ${args.map(shellQuote).join(" ")}`,
    status: "running",
    severity: "info",
    provider: "harness",
  });

  let approvalToken: string | undefined;
  let res = await startProcess({
    sessionId,
    cwd,
    command,
    args,
    signal: opts.signal,
    approvalToken,
  });

  // Interactive approval loop (at most one user decision + retry)
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      code?: string;
      approval?: ApprovalRequest;
      policy?: string;
    };

    const approval =
      err.approval ??
      (err as { details?: { approval?: ApprovalRequest } }).details?.approval;
    if (err.code === "approval_required" && approval) {
      // Not "running" — avoids git-watch thrash while the modal is open
      store.updateSession(sessionId, { status: "ready", error: undefined });
      store.applyStreamEvent(sessionId, {
        type: "system",
        timestamp: Date.now(),
        title: "Approval required",
        content: `${approval.reason}\n\n${approval.preview}`,
        status: "pending",
        severity: "policy",
        provider: "spok",
        meta: {
          audit: true,
          auditType: "approval_request",
          approvalId: approval.id,
          risk: approval.risk,
          profile: approval.profile,
        },
      });

      let userDecision: {
        decision: "allow_once" | "allow_always" | "deny";
        onceToken?: string;
      };
      try {
        userDecision = await requestUserApproval(approval);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Approval flow failed";
        store.updateSession(sessionId, { status: "ready", error: undefined });
        store.applyStreamEvent(sessionId, {
          type: "error",
          timestamp: Date.now(),
          title: "Approval interrupted",
          content: message,
          status: "error",
          severity: "policy",
          provider: "spok",
        });
        throw new Error(message);
      }

      if (userDecision.decision === "deny") {
        store.updateSession(sessionId, { status: "ready", error: undefined });
        store.applyStreamEvent(sessionId, {
          type: "system",
          timestamp: Date.now(),
          title: "Approval denied",
          content: "You denied this command. Nothing was executed.",
          status: "skipped",
          severity: "policy",
          provider: "spok",
          meta: {
            audit: true,
            auditType: "approval_decision",
            decision: "deny",
          },
        });
        return { code: null };
      }

      store.applyStreamEvent(sessionId, {
        type: "system",
        timestamp: Date.now(),
        title: "Approval granted",
        content: `Decision: ${userDecision.decision.replace(/_/g, " ")}`,
        status: "success",
        severity: "info",
        provider: "spok",
        meta: {
          audit: true,
          auditType: "approval_decision",
          decision: userDecision.decision,
        },
      });

      if (!userDecision.onceToken) {
        const message =
          "Approval succeeded but no launch token was issued. Try again.";
        store.updateSession(sessionId, { status: "error", error: message });
        throw new Error(message);
      }

      store.updateSession(sessionId, { status: "starting", error: undefined });
      approvalToken = userDecision.onceToken;
      res = await startProcess({
        sessionId,
        cwd,
        command,
        args,
        signal: opts.signal,
        approvalToken,
      });
    } else {
      const message = err.error || "Failed to start process";
      store.updateSession(sessionId, { status: "error", error: message });
      store.applyStreamEvent(sessionId, {
        type: "error",
        timestamp: Date.now(),
        title:
          err.code === "untrusted_cwd"
            ? "Workspace not trusted"
            : err.code === "command_not_allowed"
              ? "Policy denial"
              : "Launch failed",
        content: message,
        status: "error",
        severity: "policy",
        meta: err.code ? { code: err.code, policy: err.policy } : undefined,
      });
      throw new Error(message);
    }
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      code?: string;
      approval?: ApprovalRequest;
    };
    // Never re-prompt in a loop if policy still asks after a grant
    const message =
      err.error ||
      (err.code === "approval_required"
        ? "Still requires approval after grant — check Settings → Grants"
        : "Failed to start process after approval");
    store.updateSession(sessionId, { status: "error", error: message });
    store.applyStreamEvent(sessionId, {
      type: "error",
      timestamp: Date.now(),
      title: "Launch failed",
      content: message,
      status: "error",
      meta: err.code ? { code: err.code } : undefined,
    });
    throw new Error(message);
  }

  store.updateSession(sessionId, { status: "running", error: undefined });

  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let exitCode: number | null = null;
  let authHintEmitted = false;
  let timedOut = false;

  const maybeAuthHint = (text: string) => {
    if (authHintEmitted || !text) return;
    const hint = detectAuthFailureHint(text);
    if (!hint) return;
    authHintEmitted = true;
    store.applyStreamEvent(sessionId, {
      type: "system",
      timestamp: Date.now(),
      title: "Grok authentication",
      content: hint,
      status: "pending",
      severity: "warn",
      provider: "spok",
      meta: { authGuidance: true, externalCliAuth: true },
    });
  };

  try {
    while (true) {
      if (opts.signal?.aborted) {
        reader.cancel().catch(() => undefined);
        await localFetch(
          `/api/session/start?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "DELETE" }
        ).catch(() => undefined);
        store.updateSession(sessionId, { status: "stopped" });
        store.applyStreamEvent(sessionId, {
          type: "system",
          timestamp: Date.now(),
          title: "Stopped",
          content: "Run cancelled by user (process tree kill requested)",
          status: "skipped",
        });
        await fireLifecycleHooks(sessionId, cwd, "stop");
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const maybe = JSON.parse(line) as {
            type?: string;
            code?: number;
            timedOut?: boolean;
            data?: string;
          };
          if (maybe.type === "exit") {
            exitCode = maybe.code ?? null;
            timedOut = !!maybe.timedOut || exitCode === 124;
            const ok = exitCode === 0;
            store.updateSession(sessionId, {
              status: ok ? "ready" : timedOut ? "stopped" : "error",
              error: ok
                ? undefined
                : timedOut
                  ? "Run timed out"
                  : `Exit code ${exitCode}`,
            });
          }
          if (
            (maybe.type === "stdout" || maybe.type === "stderr") &&
            typeof maybe.data === "string"
          ) {
            maybeAuthHint(maybe.data);
          }
        } catch {
          /* not json envelope */
        }

        maybeAuthHint(line);

        const result = ingest.ingestLine(line, Date.now());
        if (result.logLine) {
          store.appendRawLog(sessionId, redactSecrets(result.logLine).text);
        }
        for (const ev of result.events) {
          const content =
            ev.content != null ? redactSecrets(ev.content).text : ev.content;
          if (typeof content === "string") maybeAuthHint(content);
          store.applyStreamEvent(sessionId, {
            ...ev,
            content,
            summary:
              ev.summary != null ? redactSecrets(ev.summary).text : ev.summary,
          });
        }
      }
    }

    if (buffer.trim()) {
      const result = ingest.ingestLine(buffer, Date.now());
      if (result.logLine) {
        store.appendRawLog(sessionId, redactSecrets(result.logLine).text);
      }
      for (const ev of result.events) {
        store.applyStreamEvent(sessionId, {
          ...ev,
          content:
            ev.content != null ? redactSecrets(ev.content).text : ev.content,
          summary:
            ev.summary != null ? redactSecrets(ev.summary).text : ev.summary,
        });
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) {
      store.updateSession(sessionId, { status: "stopped" });
      return { code: null };
    }
    const message = e instanceof Error ? e.message : "Stream error";
    store.updateSession(sessionId, { status: "error", error: message });
    store.applyStreamEvent(sessionId, {
      type: "error",
      timestamp: Date.now(),
      title: "Stream error",
      content: message,
      status: "error",
    });
    throw e;
  }

  try {
    await refreshGitDiff(sessionId, cwd);
  } catch {
    /* optional */
  }

  const s = useSpokStore.getState().sessions[sessionId];
  const endStatus = timedOut
    ? "stopped"
    : exitCode === 0
      ? "completed"
      : exitCode == null
        ? "stopped"
        : "error";

  // Always clear live flags so mobile/desktop banners drop immediately
  if (s) {
    store.updateSession(sessionId, {
      status: endStatus,
      error: timedOut
        ? "Run timed out"
        : exitCode && exitCode !== 0
          ? s.error
          : undefined,
    });
  }

  if (timedOut) {
    store.applyStreamEvent(sessionId, {
      type: "system",
      timestamp: Date.now(),
      title: "Timed out",
      content:
        "The Grok process was stopped after the run timeout. Adjust SPOK_RUN_TIMEOUT_MS (ms, 0=unlimited) if needed.",
      status: "error",
      severity: "warn",
      provider: "spok",
    });
  } else {
    store.applyStreamEvent(sessionId, {
      type: "session_end",
      timestamp: Date.now(),
      title: endStatus === "completed" ? "Run complete" : "Run ended",
      content:
        endStatus === "completed"
          ? "Session finished successfully."
          : `Process exited (code ${exitCode ?? "—"})`,
      status: endStatus === "completed" ? "success" : "error",
      provider: "harness",
    });
  }

  // Always fire stop when a run finishes; also session_end on clean exit
  // (hooks should not list both events unless they want both)
  await fireLifecycleHooks(sessionId, cwd, "stop");
  if (exitCode === 0) {
    await fireLifecycleHooks(sessionId, cwd, "session_end");
  }

  try {
    // Persist final status to disk so peers (phone/desktop) clear "live"
    store.persistSessionNow(sessionId);
  } catch {
    /* optional */
  }

  return { code: exitCode };
}

/** Run trusted hooks and materialize their trace events into the session. */
async function fireLifecycleHooks(
  sessionId: string,
  cwd: string,
  event: "stop" | "session_end" | "session_start" | "prompt_submit"
): Promise<void> {
  try {
    const { results } = await runSessionHooks({
      event,
      sessionId,
      cwd,
    });
    const store = useSpokStore.getState();
    applyHookResultsToSession(sessionId, results, (sid, ev) => {
      store.applyStreamEvent(sid, ev);
    });
  } catch {
    /* hooks must never break the harness loop */
  }
}

async function startProcess(opts: {
  sessionId: string;
  cwd: string;
  command: string;
  args: string[];
  signal?: AbortSignal;
  approvalToken?: string;
}): Promise<Response> {
  return localFetch("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      command: opts.command,
      args: opts.args,
      approvalToken: opts.approvalToken,
    }),
    signal: opts.signal,
  });
}

export async function refreshGitDiff(sessionId: string, cwd: string) {
  const { syncDiffsFromGit } = await import("./git/client");
  await syncDiffsFromGit(sessionId, cwd);
}

function shellQuote(s: string): string {
  if (!/[\s"']/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
