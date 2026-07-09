"use client";

import { useSpokStore } from "./store";
import { GrokStreamIngestor } from "./grok-stream";
import { localFetch } from "./local-api-client";
import { redactSecrets } from "./security/secrets";

export type HarnessHandle = {
  sessionId: string;
  abort: () => void;
};

/**
 * Stream a Grok CLI invocation into a Spok session.
 * Deserializes Grok streaming-json / ACP session updates into friendly traces.
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

  store.updateSession(sessionId, { status: "running", error: undefined });
  store.applyStreamEvent(sessionId, {
    type: "system",
    timestamp: Date.now(),
    title: "Run",
    content: label
      ? `${label}\n$ ${command} ${args.map(shellQuote).join(" ")}`
      : `$ ${command} ${args.map(shellQuote).join(" ")}`,
    status: "running",
  });

  const res = await localFetch("/api/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, cwd, command, args }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      code?: string;
    };
    const message = err.error || "Failed to start process";
    store.updateSession(sessionId, { status: "error", error: message });
    store.applyStreamEvent(sessionId, {
      type: "error",
      timestamp: Date.now(),
      title: err.code === "untrusted_cwd" ? "Workspace not trusted" : "Launch failed",
      content: message,
      status: "error",
      meta: err.code ? { code: err.code } : undefined,
    });
    throw new Error(message);
  }

  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let exitCode: number | null = null;

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
          content: "Run cancelled by user",
          status: "skipped",
        });
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        // Exit envelope still needs special handling for session status
        try {
          const maybe = JSON.parse(line) as { type?: string; code?: number };
          if (maybe.type === "exit") {
            exitCode = maybe.code ?? null;
            const ok = exitCode === 0;
            store.updateSession(sessionId, {
              status: ok ? "ready" : "error",
              error: ok ? undefined : `Exit code ${exitCode}`,
            });
          }
        } catch {
          /* not json envelope */
        }

        const result = ingest.ingestLine(line, Date.now());
        if (result.logLine) {
          store.appendRawLog(sessionId, redactSecrets(result.logLine).text);
        }
        for (const ev of result.events) {
          store.applyStreamEvent(sessionId, {
            ...ev,
            content: ev.content != null ? redactSecrets(ev.content).text : ev.content,
            summary: ev.summary != null ? redactSecrets(ev.summary).text : ev.summary,
          });
        }
      }
    }

    // Flush any remaining partial line
    if (buffer.trim()) {
      const result = ingest.ingestLine(buffer, Date.now());
      if (result.logLine) {
        store.appendRawLog(sessionId, redactSecrets(result.logLine).text);
      }
      for (const ev of result.events) {
        store.applyStreamEvent(sessionId, {
          ...ev,
          content: ev.content != null ? redactSecrets(ev.content).text : ev.content,
          summary: ev.summary != null ? redactSecrets(ev.summary).text : ev.summary,
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

  // Final git snapshot so untracked/new files (e.g. plan.md) appear in Diff
  try {
    await refreshGitDiff(sessionId, cwd);
  } catch {
    /* optional */
  }

  const s = useSpokStore.getState().sessions[sessionId];
  if (s && (s.status === "running" || s.status === "starting")) {
    store.updateSession(sessionId, { status: "ready" });
  }

  // Flush durable event log + snapshot so reopen can restore
  try {
    store.persistSessionNow(sessionId);
  } catch {
    /* optional */
  }

  return { code: exitCode };
}

export async function refreshGitDiff(sessionId: string, cwd: string) {
  const res = await localFetch(
    `/api/session/git-diff?cwd=${encodeURIComponent(cwd)}`
  );
  if (!res.ok) return;
  const data = (await res.json()) as {
    diff?: string;
    files?: Array<{
      path: string;
      status: string;
      oldContent?: string;
      newContent?: string;
      skipped?: boolean;
    }>;
  };

  const store = useSpokStore.getState();
  const { parseUnifiedDiff, createFileDiff } = await import("./diff-utils");

  if (data.diff) {
    for (const f of parseUnifiedDiff(data.diff)) {
      store.upsertFileDiff(sessionId, f);
    }
  }
  if (data.files?.length) {
    for (const f of data.files) {
      store.upsertFileDiff(
        sessionId,
        createFileDiff({
          path: f.path,
          oldContent: f.oldContent ?? "",
          newContent: f.newContent ?? "",
          status:
            f.status === "added" || f.status === "untracked"
              ? "added"
              : f.status === "deleted"
                ? "deleted"
                : "modified",
        })
      );
    }
  }
}

function shellQuote(s: string): string {
  if (!/[\s"']/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
