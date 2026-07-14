import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "child_process";
import { existsSync } from "fs";
import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { requireTrustedCwd } from "@/lib/security/workspace-trust";
import { redactSecrets } from "@/lib/security/secrets";
import { getResolvedSettings } from "@/lib/settings/settings-fs";
import {
  buildSpawnPreview,
  evaluatePolicy,
} from "@/lib/security/permission-policy";
import {
  consumeOnceToken,
  createApprovalRequest,
  getActiveGrants,
} from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";
import { resolveCommandProfile } from "@/lib/security/command-profiles";
import { probeGrokCapabilities } from "@/lib/runtime/grok-capabilities";
import {
  compileGrokRunSpec,
  formatGrokRunReceipt,
  GrokRunSpecError,
  parseGrokRunSpec,
  type GrokRunReceipt,
  type GrokRunSpec,
} from "@/lib/runtime/grok-run-spec";
import {
  defaultRunTimeoutMs,
  killProcessTree,
  registerProcess,
  unregisterProcess,
  stopSessionProcess,
  scheduleForceKill,
  pruneStaleProcesses,
} from "@/lib/process-lifecycle";

/**
 * Shared session spawn/stop handlers (Track A PR1b).
 * Next App Router and the standalone runtime both call these.
 */

type StartBody = {
  sessionId: string;
  /** Preferred, capability-pinned Grok launch contract. */
  runSpec?: unknown;
  cwd?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** One-shot approval token from allow_once */
  approvalToken?: string;
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

function runSpecDenial(error: GrokRunSpecError): Response {
  return policyDenialResponse(error.category === "capability" ? 409 : 400, {
    error: error.message,
    code:
      error.code === "invalid_run_spec"
        ? "invalid_run_spec"
        : "capability_mismatch",
    policy: "provider_contract",
    action: "session_start",
    details: {
      category: error.category,
      issues: error.issues,
      correctiveAction: error.correctiveAction,
    },
  });
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

export async function handleSessionStartPost(req: Request): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "session_start");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body.sessionId || crypto.randomUUID();
  let parsedRunSpec: GrokRunSpec | null = null;
  let command: string;
  let args: string[];
  let requestedCwd: string;

  if (body.runSpec !== undefined) {
    const ambiguous = (["command", "args", "cwd"] as const).filter(
      (field) => body[field] !== undefined
    );
    if (ambiguous.length > 0) {
      return policyDenialResponse(400, {
        error: "GrokRunSpec cannot be combined with legacy launch fields.",
        code: "invalid_run_spec",
        policy: "provider_contract",
        action: "session_start",
        details: {
          fields: ambiguous,
          correctiveAction: "Send runSpec as the sole source of command, cwd, and argv.",
        },
      });
    }
    try {
      parsedRunSpec = parseGrokRunSpec(body.runSpec);
    } catch (error) {
      if (error instanceof GrokRunSpecError) return runSpecDenial(error);
      throw error;
    }
    command = parsedRunSpec.command;
    args = [];
    requestedCwd = parsedRunSpec.cwd;
  } else {
    command = body.command || process.env.SPOK_GROK_CMD || "grok";
    // Coerce every arg to string; drop null/undefined; never re-split
    args = (body.args ?? [])
      .filter((a): a is string => a != null && String(a).length >= 0)
      .map((a) => String(a));
    requestedCwd = body.cwd || process.cwd();
  }

  const trust = requireTrustedCwd(requestedCwd);
  if (!trust.ok) {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      sessionId,
      action: "spawn",
      cwd: trust.path,
      command,
      args,
      policy: "workspace_trust",
      decision: "blocked",
    });
    return policyDenialResponse(403, {
      error: trust.reason,
      code: "untrusted_cwd",
      policy: "workspace_trust",
      action: "session_start",
      details: { cwd: trust.path },
    });
  }
  const cwd = trust.path;

  if (!existsSync(cwd)) {
    return Response.json(
      { error: `Working directory does not exist: ${cwd}` },
      { status: 400 }
    );
  }

  let runReceipt: GrokRunReceipt | null = null;
  if (parsedRunSpec) {
    if (resolveCommandProfile(command).id !== "grok") {
      return policyDenialResponse(400, {
        error: "GrokRunSpec command must resolve to the Grok CLI profile.",
        code: "invalid_run_spec",
        policy: "provider_contract",
        action: "session_start",
        details: {
          correctiveAction: "Use the discovered grok, grok.cmd, or grok.exe command.",
        },
      });
    }
    try {
      const capabilitySnapshot = await probeGrokCapabilities({
        command,
        cwd,
        includeLeaderHealth: !!parsedRunSpec.execution.leaderSocket,
      });
      const compiled = compileGrokRunSpec(parsedRunSpec, capabilitySnapshot);
      command = compiled.command;
      args = [...compiled.args];
      runReceipt = compiled.receipt;
    } catch (error) {
      if (error instanceof GrokRunSpecError) {
        appendAuditEvent({
          type: "policy_denial",
          timestamp: Date.now(),
          sessionId,
          action: "spawn",
          cwd,
          command,
          args: [],
          policy: "provider_contract",
          decision: "blocked",
          details: {
            code: error.code,
            issues: error.issues,
            correctiveAction: error.correctiveAction,
          },
        });
        return runSpecDenial(error);
      }
      return policyDenialResponse(409, {
        error: "Grok capability preflight failed before launch.",
        code: "capability_mismatch",
        policy: "provider_contract",
        action: "session_start",
        details: {
          correctiveAction: "Repair the Grok CLI preflight and rebuild the run spec.",
        },
      });
    }
  }

  const auditArgs = runReceipt ? [...runReceipt.argvPreview] : args;

  const settings = getResolvedSettings(cwd);
  const once = consumeOnceToken(body.approvalToken, {
    action: "spawn",
    command,
    args,
    cwd,
  });
  const profile = resolveCommandProfile(command);
  const decision = evaluatePolicy({
    settings,
    action: "spawn",
    sessionId,
    cwd,
    command,
    args,
    grants: getActiveGrants(),
    approvedFingerprint: once?.fingerprint,
  });

  if (decision.decision === "deny") {
    appendAuditEvent({
      type: "policy_denial",
      timestamp: Date.now(),
      sessionId,
      action: "spawn",
      cwd,
      command,
      args: auditArgs,
      profile: decision.profile,
      policy: decision.policy,
      decision: "blocked",
      risk: decision.risk,
      details: { reason: decision.reason, runReceipt },
    });
    return policyDenialResponse(403, {
      error: decision.reason,
      code: "command_not_allowed",
      policy: "command_profile",
      action: "session_start",
      details: {
        command,
        args: auditArgs,
        cwd,
        profile: decision.profile,
        policy: decision.policy,
        risk: decision.risk,
      },
    });
  }

  if (decision.decision === "ask") {
    const preview = runReceipt
      ? formatGrokRunReceipt(runReceipt)
      : buildSpawnPreview(command, args, cwd);
    const request = createApprovalRequest(
      {
        action: "spawn",
        sessionId,
        cwd,
        command,
        args: auditArgs,
        profile: profile.id,
        risk: decision.risk,
        reason: decision.reason,
        policy: decision.policy,
        preview,
      },
      runReceipt ? { fingerprintArgs: args } : {}
    );
    appendAuditEvent({
      type: "approval_request",
      timestamp: Date.now(),
      sessionId,
      action: "spawn",
      cwd,
      command,
      args: auditArgs,
      profile: profile.id,
      policy: decision.policy,
      risk: decision.risk,
      details: { requestId: request.id, runReceipt },
    });
    // Keep `approval` at top level for the client overlay; also mirror details.
    return Response.json(
      {
        error: decision.reason,
        code: "approval_required",
        policy: decision.policy,
        action: "session_start",
        approval: request,
        details: {
          profile: profile.id,
          risk: decision.risk,
          command,
          args: auditArgs,
          cwd,
          runReceipt,
        },
      },
      { status: 403 }
    );
  }

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    sessionId,
    action: "spawn",
    cwd,
    command,
    args: auditArgs,
    profile: decision.profile,
    policy: decision.policy,
    decision: "allowed",
    risk: decision.risk,
    details: { runReceipt },
  });

  // Client-supplied env is ignored (safer default). Process inherits server env only.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    SPOK_SESSION_ID: sessionId,
  };

  const encoder = new TextEncoder();
  let child: ChildProcessWithoutNullStreams | null = null;
  let closed = false;
  const cmdline = formatCommandLine(command, args);
  const safeArgvPreview = runReceipt
    ? JSON.stringify([command, ...auditArgs])
    : redactSecrets(JSON.stringify([command, ...args])).text;

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
          content: runReceipt
            ? formatGrokRunReceipt(runReceipt)
            : `Spawning: ${redactSecrets(cmdline).text}\ncwd=${cwd}\nargv=${safeArgvPreview}`,
          status: "running",
        },
      });

      try {
        child = spawnCli(command, args, {
          cwd,
          env: childEnv,
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

      const timeoutMs = defaultRunTimeoutMs();
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;

      const trackChild = (c: ChildProcessWithoutNullStreams) => {
        if (c.pid) {
          registerProcess(
            {
              sessionId,
              pid: c.pid,
              command,
              args: auditArgs,
              cwd,
              startedAt: Date.now(),
              timeoutMs,
            },
            c
          );
        }
      };

      trackChild(child);

      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          push({
            type: "event",
            event: {
              type: "system",
              timestamp: Date.now(),
              title: "Run timeout",
              content: `Process exceeded ${Math.round(timeoutMs / 1000)}s limit (SPOK_RUN_TIMEOUT_MS). Stopping process tree.`,
              status: "error",
              severity: "error",
            },
          });
          if (child && !child.killed) {
            killProcessTree(child, { force: true });
            scheduleForceKill(child, 2000);
          }
        }, timeoutMs);
        timeoutTimer.unref?.();
      }

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
              env: childEnv,
              shell: false,
              windowsHide: true,
            }) as ChildProcessWithoutNullStreams;
            trackChild(child);
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
                ? ` — is '${command}' installed and on PATH? Authenticate via the native Grok CLI if needed, then retry. Samples work without the CLI.`
                : ""),
            status: "error",
          },
        });
      });

      function onClose(code: number | null, signal: NodeJS.Signals | null) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        unregisterProcess(sessionId);
        push({
          type: "exit",
          code: timedOut ? 124 : code ?? (signal ? 1 : 0),
          signal: timedOut ? "SIGTERM" : signal,
          sessionId,
          timedOut,
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
      stopSessionProcess(sessionId, { force: true });
      unregisterProcess(sessionId);
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

export async function handleSessionStartDelete(req: Request): Promise<Response> {
  const auth = authorizePrivilegedRequest(req, "session_stop");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  pruneStaleProcesses();
  const result = stopSessionProcess(sessionId, { force: true });
  unregisterProcess(sessionId);

  appendAuditEvent({
    type: "runtime_action",
    timestamp: Date.now(),
    sessionId,
    action: "session_stop",
    decision: "allowed",
    details: {
      found: result.found,
      method: result.method,
      error: result.error,
    },
  });

  if (!result.found) {
    return Response.json({ ok: true, message: "No running process" });
  }
  return Response.json({
    ok: result.ok,
    method: result.method,
    error: result.error,
  });
}
