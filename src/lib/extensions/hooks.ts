import { existsSync, readFileSync } from "fs";
import { spawn } from "child_process";
import type {
  ExtensionPreferences,
  ExtensionTrustState,
  HookDefinition,
  HookEvent,
  HookRunRequest,
  HookRunResult,
} from "./types";
import { projectHooksPath } from "./paths";
import { evaluatePolicy } from "@/lib/security/permission-policy";
import type { SpokSettings } from "@/lib/settings/types";
import { listApprovalGrants } from "@/lib/security/approvals";
import { appendAuditEvent } from "@/lib/security/audit";
import { redactSecrets } from "@/lib/security/secrets";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const HOOK_EVENTS: HookEvent[] = [
  "session_start",
  "session_end",
  "prompt_submit",
  "pre_tool_use",
  "post_tool_use",
  "permission_request",
  "file_changed",
  "stop",
  "subagent_start",
  "subagent_end",
];

export function sanitizeHook(
  input: unknown,
  defaults: {
    source: HookDefinition["source"];
    trust?: ExtensionTrustState;
  }
): HookDefinition | null {
  if (!isObject(input)) return null;
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : typeof input.name === "string"
        ? `hook-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        : null;
  if (!id) return null;
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : id;
  const kind =
    input.kind === "command" || input.kind === "notify" ? input.kind : "trace";
  const events = Array.isArray(input.events)
    ? (input.events.filter((e) =>
        HOOK_EVENTS.includes(e as HookEvent)
      ) as HookEvent[])
    : [];
  if (!events.length) return null;

  return {
    id,
    name,
    description:
      typeof input.description === "string" ? input.description : undefined,
    events,
    kind,
    enabled: input.enabled !== false,
    source: defaults.source,
    trust:
      defaults.trust ??
      (defaults.source === "user" || defaults.source === "builtin"
        ? "trusted"
        : "untrusted"),
    message: typeof input.message === "string" ? input.message : undefined,
    command: typeof input.command === "string" ? input.command : undefined,
    args: Array.isArray(input.args)
      ? input.args.filter((a): a is string => typeof a === "string")
      : undefined,
    timeoutMs:
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? Math.max(500, Math.min(60_000, Math.floor(input.timeoutMs)))
        : 8_000,
    pluginId: typeof input.pluginId === "string" ? input.pluginId : undefined,
    configPath:
      typeof input.configPath === "string" ? input.configPath : undefined,
  };
}

/** Built-in stop hook that always emits a trace breadcrumb when enabled. */
export function builtinHooks(): HookDefinition[] {
  return [
    {
      id: "builtin:stop-trace",
      name: "Stop breadcrumb",
      description:
        "Adds a system trace event whenever a run stops or exits. Safe default for observability.",
      events: ["stop"],
      kind: "trace",
      enabled: true,
      source: "builtin",
      trust: "trusted",
      message:
        "Hook · run {{event}} for session {{sessionId}}\ncwd: {{cwd}}",
    },
  ];
}

export function loadProjectHooks(cwd?: string): HookDefinition[] {
  if (!cwd?.trim()) return [];
  const p = projectHooksPath(cwd);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : isObject(raw) && Array.isArray(raw.hooks)
        ? raw.hooks
        : [];
    return list
      .map((h) =>
        sanitizeHook(
          isObject(h) ? { ...h, configPath: p } : h,
          { source: "project", trust: "untrusted" }
        )
      )
      .filter((h): h is HookDefinition => !!h);
  } catch {
    return [];
  }
}

export function mergeHooks(opts: {
  builtin: HookDefinition[];
  user: HookDefinition[];
  project: HookDefinition[];
  plugin: HookDefinition[];
  prefs: ExtensionPreferences;
}): HookDefinition[] {
  const map = new Map<string, HookDefinition>();
  for (const h of [
    ...opts.builtin,
    ...opts.plugin,
    ...opts.project,
    ...opts.user,
  ]) {
    map.set(h.id, { ...h });
  }
  for (const h of opts.prefs.userHooks) {
    const s = sanitizeHook(h, {
      source: "user",
      trust: h.trust ?? "trusted",
    });
    if (s) map.set(s.id, s);
  }
  for (const [id, ov] of Object.entries(opts.prefs.hooks)) {
    const cur = map.get(id);
    if (!cur) continue;
    if (ov.enabled !== undefined) cur.enabled = ov.enabled;
    if (ov.trust) cur.trust = ov.trust;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function applyHookTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

/**
 * Run hooks for a lifecycle event.
 * - untrusted hooks are skipped (pending trust review)
 * - denied hooks are skipped
 * - command hooks require policy allow (or are skipped with reason)
 * - trace/notify hooks only produce session events
 */
export async function runHooks(
  request: HookRunRequest,
  hooks: HookDefinition[],
  settings: SpokSettings
): Promise<HookRunResult[]> {
  const matching = hooks.filter((h) => {
    if (!h.enabled) return false;
    if (!h.events.includes(request.event)) return false;
    if (request.hookIds?.length && !request.hookIds.includes(h.id)) return false;
    return true;
  });

  const results: HookRunResult[] = [];
  const vars: Record<string, string> = {
    event: request.event,
    sessionId: request.sessionId,
    cwd: request.cwd ?? "",
    ...(request.vars ?? {}),
  };

  for (const hook of matching) {
    const started = Date.now();
    if (hook.trust === "denied") {
      results.push(skip(hook, request.event, started, "Hook denied by user"));
      continue;
    }
    if (hook.trust === "untrusted" || hook.trust === "pending_review") {
      results.push(
        skip(
          hook,
          request.event,
          started,
          "Hook needs trust review in Extension Center before it can run"
        )
      );
      continue;
    }

    if (hook.kind === "trace" || hook.kind === "notify") {
      const content = applyHookTemplate(
        hook.message || `Hook ${hook.name} fired on ${request.event}`,
        vars
      );
      const redacted = redactSecrets(content).text;
      results.push({
        hookId: hook.id,
        hookName: hook.name,
        event: request.event,
        ok: true,
        durationMs: Date.now() - started,
        events: [
          {
            type: "system",
            title: `Hook · ${hook.name}`,
            content: redacted,
            status: "success",
            meta: {
              hook: true,
              hookId: hook.id,
              hookEvent: request.event,
              hookKind: hook.kind,
              source: hook.source,
            },
          },
        ],
      });
      appendAuditEvent({
        type: "runtime_action",
        timestamp: Date.now(),
        sessionId: request.sessionId,
        action: "hook",
        cwd: request.cwd,
        policy: `hook:${hook.id}`,
        decision: "allowed",
        details: { event: request.event, kind: hook.kind },
      });
      continue;
    }

    // command hook
    if (!hook.command?.trim()) {
      results.push(
        skip(hook, request.event, started, "Command hook missing binary")
      );
      continue;
    }

    const policy = evaluatePolicy({
      settings,
      action: "hook",
      sessionId: request.sessionId,
      cwd: request.cwd,
      command: hook.command,
      args: hook.args ?? [],
      grants: listApprovalGrants(),
    });

    if (policy.decision === "deny" || policy.requiresApproval) {
      results.push({
        hookId: hook.id,
        hookName: hook.name,
        event: request.event,
        ok: false,
        skipped: true,
        reason: policy.reason,
        durationMs: Date.now() - started,
        events: [
          {
            type: "system",
            title: `Hook blocked · ${hook.name}`,
            content: policy.reason,
            status: "skipped",
            meta: {
              hook: true,
              hookId: hook.id,
              policy: policy.policy,
              decision: policy.decision,
            },
          },
        ],
      });
      appendAuditEvent({
        type: "policy_denial",
        timestamp: Date.now(),
        sessionId: request.sessionId,
        action: "hook",
        cwd: request.cwd,
        command: hook.command,
        args: hook.args,
        policy: policy.policy,
        decision: "blocked",
        details: { event: request.event, reason: policy.reason },
      });
      continue;
    }

    const execResult = await runCommandHook(hook, request.cwd);
    const stdout = redactSecrets(execResult.stdout || "").text;
    const stderr = redactSecrets(execResult.stderr || "").text;
    const ok = execResult.exitCode === 0;
    results.push({
      hookId: hook.id,
      hookName: hook.name,
      event: request.event,
      ok,
      durationMs: Date.now() - started,
      stdout,
      stderr,
      exitCode: execResult.exitCode,
      events: [
        {
          type: ok ? "system" : "error",
          title: `Hook · ${hook.name}`,
          content: [
            `$ ${hook.command} ${(hook.args ?? []).join(" ")}`.trim(),
            stdout ? `stdout:\n${stdout.slice(0, 4000)}` : null,
            stderr ? `stderr:\n${stderr.slice(0, 2000)}` : null,
            `exit=${execResult.exitCode ?? "?"}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          status: ok ? "success" : "error",
          meta: {
            hook: true,
            hookId: hook.id,
            hookEvent: request.event,
            exitCode: execResult.exitCode,
          },
        },
      ],
    });
    appendAuditEvent({
      type: "runtime_action",
      timestamp: Date.now(),
      sessionId: request.sessionId,
      action: "hook",
      cwd: request.cwd,
      command: hook.command,
      args: hook.args,
      policy: `hook:${hook.id}`,
      decision: ok ? "allowed" : "blocked",
      details: { event: request.event, exitCode: execResult.exitCode },
    });
  }

  return results;
}

function skip(
  hook: HookDefinition,
  event: HookEvent,
  started: number,
  reason: string
): HookRunResult {
  return {
    hookId: hook.id,
    hookName: hook.name,
    event,
    ok: false,
    skipped: true,
    reason,
    durationMs: Date.now() - started,
    events: [
      {
        type: "system",
        title: `Hook skipped · ${hook.name}`,
        content: reason,
        status: "skipped",
        meta: {
          hook: true,
          hookId: hook.id,
          hookEvent: event,
          skipped: true,
        },
      },
    ],
  };
}

function runCommandHook(
  hook: HookDefinition,
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const timeout = hook.timeoutMs ?? 8_000;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(hook.command!, hook.args ?? [], {
      cwd: cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({
        stdout,
        stderr: stderr + "\n[spok] hook timed out",
        exitCode: null,
      });
    }, timeout);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
      if (stdout.length > 64_000) stdout = stdout.slice(0, 64_000);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
      if (stderr.length > 32_000) stderr = stderr.slice(0, 32_000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + (err.message || "spawn error"),
        exitCode: null,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}
