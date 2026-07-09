import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "child_process";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory process registry for stop support
const processes = new Map<string, ChildProcessWithoutNullStreams>();

type StartBody = {
  sessionId: string;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

function ndjson(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

/** Quote for display / Windows cmd if we ever need a shell fallback */
function quoteArg(arg: string): string {
  if (arg.length === 0) return '""';
  // Safe unquoted token
  if (!/[\s"&<>|^%!()]/.test(arg)) return arg;
  // Windows cmd double-quote escaping: " -> ""
  return `"${arg.replace(/"/g, '""')}"`;
}

function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args.map(quoteArg)].join(" ");
}

/**
 * Spawn without a shell so multi-word argv (e.g. -p "Audit this repo…")
 * is preserved. shell:true on Windows re-tokenizes and breaks prompts.
 */
function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  // shell: false — CreateProcess / execve receive real argv array
  return spawn(command, args, {
    ...options,
    shell: false,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
}

export async function POST(req: Request) {
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId || crypto.randomUUID();
  const command = body.command || process.env.SPOK_GROK_CMD || "grok";
  // Coerce every arg to string; drop null/undefined; never re-split
  const args = (body.args ?? [])
    .filter((a): a is string => a != null && String(a).length >= 0)
    .map((a) => String(a));
  const cwd = body.cwd || process.cwd();

  if (body.cwd && !existsSync(body.cwd)) {
    return Response.json(
      { error: `Working directory does not exist: ${body.cwd}` },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  let child: ChildProcessWithoutNullStreams | null = null;
  let closed = false;
  const cmdline = formatCommandLine(command, args);

  const stream = new ReadableStream({
    start(controller) {
      const push = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(ndjson(obj)));
        } catch {
          /* stream closed */
        }
      };

      push({
        type: "event",
        event: {
          type: "system",
          timestamp: Date.now(),
          title: "Harness",
          content: `Spawning: ${cmdline}\ncwd=${cwd}\nargv=${JSON.stringify([command, ...args])}`,
          status: "running",
        },
      });

      try {
        child = spawnCli(command, args, {
          cwd,
          env: {
            ...process.env,
            ...body.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            SPOK_SESSION_ID: sessionId,
          },
        });
      } catch (e) {
        push({
          type: "event",
          event: {
            type: "error",
            timestamp: Date.now(),
            title: "Spawn failed",
            content: e instanceof Error ? e.message : String(e),
            status: "error",
          },
        });
        push({ type: "exit", code: 1 });
        closed = true;
        controller.close();
        return;
      }

      processes.set(sessionId, child);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        push({ type: "stdout", data: chunk, sessionId });
      });

      child.stderr.on("data", (chunk: string) => {
        push({ type: "stderr", data: chunk, sessionId });
      });

      child.on("error", (err) => {
        // On Windows, bare "grok" without shell may fail if only a .cmd shim exists.
        // Retry once via cmd.exe /c with properly quoted arguments.
        if (
          process.platform === "win32" &&
          !child?.pid &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          try {
            const quoted = formatCommandLine(command, args);
            child = spawn("cmd.exe", ["/d", "/s", "/c", quoted], {
              cwd,
              env: {
                ...process.env,
                ...body.env,
                FORCE_COLOR: "0",
                NO_COLOR: "1",
                SPOK_SESSION_ID: sessionId,
              },
              shell: false,
              windowsHide: true,
            }) as ChildProcessWithoutNullStreams;
            processes.set(sessionId, child);
            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
              push({ type: "stdout", data: chunk, sessionId });
            });
            child.stderr.on("data", (chunk: string) => {
              push({ type: "stderr", data: chunk, sessionId });
            });
            child.on("close", onClose);
            child.on("error", (err2) => {
              push({
                type: "event",
                event: {
                  type: "error",
                  timestamp: Date.now(),
                  title: "Process error",
                  content: err2.message,
                  status: "error",
                },
              });
            });
            push({
              type: "event",
              event: {
                type: "system",
                timestamp: Date.now(),
                title: "Harness",
                content: `Retried via cmd.exe /c with quoted argv`,
                status: "running",
              },
            });
            return;
          } catch (e2) {
            push({
              type: "event",
              event: {
                type: "error",
                timestamp: Date.now(),
                title: "Spawn retry failed",
                content: e2 instanceof Error ? e2.message : String(e2),
                status: "error",
              },
            });
          }
        }

        push({
          type: "event",
          event: {
            type: "error",
            timestamp: Date.now(),
            title: "Process error",
            content:
              err.message +
              (err.message.includes("ENOENT")
                ? ` — is '${command}' installed and on PATH? Try samples if CLI is unavailable.`
                : ""),
            status: "error",
          },
        });
      });

      function onClose(code: number | null, signal: NodeJS.Signals | null) {
        processes.delete(sessionId);
        push({
          type: "exit",
          code: code ?? (signal ? 1 : 0),
          signal,
          sessionId,
        });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }

      child.on("close", onClose);
    },
    cancel() {
      closed = true;
      const proc = processes.get(sessionId);
      if (proc && !proc.killed) {
        proc.kill();
        processes.delete(sessionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Spok-Session-Id": sessionId,
    },
  });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  const proc = processes.get(sessionId);
  if (!proc) {
    return Response.json({ ok: true, message: "No running process" });
  }
  proc.kill();
  processes.delete(sessionId);
  return Response.json({ ok: true });
}

void path;
