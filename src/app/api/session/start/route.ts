import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
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

export async function POST(req: Request) {
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId || crypto.randomUUID();
  const command = body.command || process.env.SPOK_GROK_CMD || "grok";
  const args = body.args ?? [];
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
          content: `Spawning: ${command} ${args.join(" ")} (cwd=${cwd})`,
          status: "running",
        },
      });

      try {
        child = spawn(command, args, {
          cwd,
          env: {
            ...process.env,
            ...body.env,
            FORCE_COLOR: "0",
            NO_COLOR: "1",
            SPOK_SESSION_ID: sessionId,
          },
          shell: process.platform === "win32",
          windowsHide: true,
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

      child.on("close", (code, signal) => {
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
      });
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

// Silence unused import warning in some bundlers
void path;
