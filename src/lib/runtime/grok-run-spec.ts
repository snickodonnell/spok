/**
 * Immutable, versioned Grok launch contract and deterministic argv compiler.
 *
 * The compiler is the only supported path from a GrokRunSpec to spawn argv.
 * It validates isolation/session/output invariants, pins the CLI-001 capability
 * snapshot, and returns a receipt that never contains inline prompt or report
 * schema contents.
 */

import { createHash } from "crypto";
import path from "path";
import { z } from "zod";
import { redactSecrets } from "@/lib/security/secrets";
import {
  GROK_CAPABILITY_SNAPSHOT_VERSION,
  checkGrokCompatibility,
  inferGrokCapabilitiesFromArgs,
  type GrokCapabilityId,
  type GrokCapabilitySnapshot,
} from "./grok-capabilities";

export const GROK_RUN_SPEC_VERSION = 1 as const;
export const MAX_GROK_RUN_TURNS = 100;
export const MAX_INLINE_PROMPT_BYTES = 512;
export const MAX_PROMPT_JSON_BYTES = 4 * 1024;
export const MAX_REPORT_SCHEMA_BYTES = 32 * 1024;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "must be a SHA-256 hex digest");
const absolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"), "must not contain NUL")
  .refine((value) => path.isAbsolute(value), "must be an absolute path");
const safeTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/@+\-]+$/, "contains unsupported characters");
const safeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, "contains unsupported characters");
const uniqueTokensSchema = z
  .array(
    safeTokenSchema.refine((value) => !value.includes(","), "must not contain commas")
  )
  .max(64)
  .refine((values) => new Set(values).size === values.length, "must not contain duplicates");

const workspaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      path: absolutePathSchema,
      isolation: z.enum(["verified", "not_required"]),
      branch: z.string().min(1).max(512).optional(),
      baseRevision: z.string().min(1).max(128).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("native_create"),
      sourcePath: absolutePathSchema,
      name: safeIdSchema,
      ref: z.string().min(1).max(512).optional(),
    })
    .strict(),
]);

const promptSchema = z.discriminatedUnion("transport", [
  z
    .object({
      transport: z.literal("file"),
      artifactId: z.string().regex(/^gpa_[a-f0-9]{24}$/).optional(),
      path: absolutePathSchema,
      sha256: sha256Schema,
      bytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
      ephemeral: z.boolean(),
    })
    .strict(),
  z
    .object({
      transport: z.literal("json"),
      value: z.string().min(1).max(MAX_PROMPT_JSON_BYTES),
      sha256: sha256Schema,
      bytes: z.number().int().positive().max(MAX_PROMPT_JSON_BYTES),
    })
    .strict(),
  z
    .object({
      transport: z.literal("inline"),
      value: z.string().min(1).max(MAX_INLINE_PROMPT_BYTES),
      sha256: sha256Schema,
      bytes: z.number().int().positive().max(MAX_INLINE_PROMPT_BYTES),
    })
    .strict(),
]);

const sessionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("new"), sessionId: z.string().uuid().optional() }).strict(),
  z.object({ intent: z.literal("resume"), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      intent: z.literal("fork"),
      sourceSessionId: z.string().uuid(),
      newSessionId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ intent: z.literal("continue_latest") }).strict(),
]);

const delegationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("deny") }).strict(),
  z.object({ mode: z.literal("allow"), budgetRef: safeIdSchema }).strict(),
]);

const outputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("stream"), format: z.literal("streaming-json") }).strict(),
  z
    .object({
      mode: z.literal("report"),
      format: z.literal("json"),
      schema: z.string().min(2).max(MAX_REPORT_SCHEMA_BYTES),
      schemaHash: sha256Schema,
      schemaBytes: z.number().int().positive().max(MAX_REPORT_SCHEMA_BYTES),
    })
    .strict(),
]);

const debugSchema = z.discriminatedUnion("retention", [
  z.object({ retention: z.literal("none") }).strict(),
  z
    .object({
      retention: z.enum(["failure", "handoff"]),
      file: absolutePathSchema,
    })
    .strict(),
]);

export const grokRunSpecSchema = z
  .object({
    version: z.literal(GROK_RUN_SPEC_VERSION),
    id: safeIdSchema,
    command: z.string().trim().min(1).max(4096).refine((value) => !value.includes("\0")),
    capabilitySnapshot: z
      .object({
        version: z.literal(GROK_CAPABILITY_SNAPSHOT_VERSION),
        fingerprint: sha256Schema,
      })
      .strict(),
    cwd: absolutePathSchema,
    unattended: z.boolean(),
    role: z.enum(["interactive", "leaf", "leader"]),
    workspace: workspaceSchema,
    prompt: promptSchema,
    session: sessionSchema,
    execution: z
      .object({
        model: safeTokenSchema.optional(),
        agent: safeTokenSchema.optional(),
        reasoningEffort: safeTokenSchema,
        maxTurns: z.number().int().min(1).max(MAX_GROK_RUN_TURNS),
        tools: z
          .object({ allow: uniqueTokensSchema, deny: uniqueTokensSchema })
          .strict(),
        webSearch: z.enum(["enabled", "disabled"]),
        alwaysApprove: z.boolean().default(false),
        permissionMode: safeTokenSchema.optional(),
        sandbox: safeTokenSchema.optional(),
        noMemory: z.boolean(),
        noPlan: z.boolean(),
        check: z.boolean(),
        delegation: delegationSchema,
        leaderSocket: absolutePathSchema.optional(),
      })
      .strict(),
    output: outputSchema,
    debug: debugSchema,
  })
  .strict()
  .superRefine((spec, ctx) => {
    const workspacePath =
      spec.workspace.kind === "existing" ? spec.workspace.path : spec.workspace.sourcePath;
    if (!samePath(workspacePath, spec.cwd)) {
      ctx.addIssue({
        code: "custom",
        path: ["workspace"],
        message: "workspace path must match cwd",
      });
    }
    if (spec.workspace.kind === "native_create" && (spec.unattended || spec.role !== "interactive")) {
      ctx.addIssue({
        code: "custom",
        path: ["workspace"],
        message: "native worktree creation is allowed only for attended interactive runs",
      });
    }
    if (
      spec.unattended &&
      (spec.workspace.kind !== "existing" || spec.workspace.isolation !== "verified")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["workspace"],
        message: "unattended runs require an existing, verified isolated worktree",
      });
    }
    if (spec.role === "leaf") {
      if (!spec.unattended) {
        ctx.addIssue({ code: "custom", path: ["unattended"], message: "leaf runs must be unattended" });
      }
      if (spec.workspace.kind !== "existing" || spec.workspace.isolation !== "verified") {
        ctx.addIssue({
          code: "custom",
          path: ["workspace"],
          message: "leaf runs require an existing, verified isolated worktree",
        });
      }
      if (spec.execution.delegation.mode !== "deny") {
        ctx.addIssue({
          code: "custom",
          path: ["execution", "delegation"],
          message: "leaf runs must deny subagents",
        });
      }
      if (!spec.execution.permissionMode || !spec.execution.sandbox) {
        ctx.addIssue({
          code: "custom",
          path: ["execution"],
          message: "leaf runs require explicit permission and sandbox policies",
        });
      }
    }
    if (
      spec.execution.delegation.mode === "allow" &&
      spec.role !== "leader" &&
      !(spec.role === "interactive" && !spec.unattended)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["execution", "delegation"],
        message: "only leader runs may receive a subagent budget",
      });
    }
    if (spec.session.intent === "continue_latest" && (spec.unattended || spec.role !== "interactive")) {
      ctx.addIssue({
        code: "custom",
        path: ["session"],
        message: "continue-latest is allowed only for attended interactive runs",
      });
    }
    if (spec.unattended && spec.session.intent === "new" && !spec.session.sessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["session", "sessionId"],
        message: "unattended new sessions require an exact session identity",
      });
    }
    if (spec.prompt.transport !== "file" && (spec.unattended || spec.role !== "interactive")) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "mission and unattended prompts must use prompt-file transport",
      });
    }
    if (spec.execution.leaderSocket && spec.role !== "leader") {
      ctx.addIssue({
        code: "custom",
        path: ["execution", "leaderSocket"],
        message: "leader sockets may be assigned only to leader runs",
      });
    }
    if (spec.execution.alwaysApprove && spec.execution.permissionMode) {
      ctx.addIssue({
        code: "custom",
        path: ["execution"],
        message: "always-approve and permission-mode are mutually exclusive",
      });
    }
    const deniedTools = new Set(spec.execution.tools.deny);
    if (spec.execution.tools.allow.some((tool) => deniedTools.has(tool))) {
      ctx.addIssue({
        code: "custom",
        path: ["execution", "tools"],
        message: "a tool cannot be both allowed and denied",
      });
    }
    if (spec.prompt.transport !== "file") {
      validatePinnedContent(spec.prompt.value, spec.prompt.sha256, spec.prompt.bytes, ["prompt"], ctx);
      if (spec.prompt.transport === "json") {
        try {
          JSON.parse(spec.prompt.value);
        } catch {
          ctx.addIssue({ code: "custom", path: ["prompt", "value"], message: "must be valid JSON" });
        }
      }
    }
    if (spec.output.mode === "report") {
      validatePinnedContent(
        spec.output.schema,
        spec.output.schemaHash,
        spec.output.schemaBytes,
        ["output"],
        ctx
      );
      try {
        const parsed = JSON.parse(spec.output.schema);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["output", "schema"],
          message: "must be a JSON object schema",
        });
      }
    }
  });

export type GrokRunSpec = z.infer<typeof grokRunSpecSchema>;

export type GrokRunReceipt = {
  version: typeof GROK_RUN_SPEC_VERSION;
  runSpecId: string;
  capabilitySnapshot: { version: number; fingerprint: string };
  command: string;
  cwd: string;
  role: GrokRunSpec["role"];
  unattended: boolean;
  workspace: GrokRunSpec["workspace"];
  session: GrokRunSpec["session"];
  prompt: {
    transport: GrokRunSpec["prompt"]["transport"];
    sha256: string;
    bytes: number;
    path?: string;
    artifactId?: string;
    ephemeral?: boolean;
  };
  execution: Omit<GrokRunSpec["execution"], "leaderSocket"> & { leaderSocket?: string };
  output: {
    mode: GrokRunSpec["output"]["mode"];
    format: GrokRunSpec["output"]["format"];
    schemaHash?: string;
    schemaBytes?: number;
  };
  debug: GrokRunSpec["debug"];
  requiredCapabilities: GrokCapabilityId[];
  argvHash: string;
  argvPreview: string[];
};

export type CompiledGrokRun = {
  spec: GrokRunSpec;
  command: string;
  args: string[];
  cwd: string;
  receipt: GrokRunReceipt;
};

export class GrokRunSpecError extends Error {
  readonly code:
    | "invalid_run_spec"
    | "capability_snapshot_mismatch"
    | "unsupported_capability";
  readonly category: "validation" | "capability";
  readonly correctiveAction: string;
  readonly issues: readonly { path: string; message: string }[];

  constructor(input: {
    code: GrokRunSpecError["code"];
    category: GrokRunSpecError["category"];
    message: string;
    correctiveAction: string;
    issues?: readonly { path: string; message: string }[];
  }) {
    super(input.message);
    this.name = "GrokRunSpecError";
    this.code = input.code;
    this.category = input.category;
    this.correctiveAction = input.correctiveAction;
    this.issues = input.issues ?? [];
  }
}

export function hashGrokRunContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseGrokRunSpec(input: unknown): GrokRunSpec {
  const parsed = grokRunSpecSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new GrokRunSpecError({
      code: "invalid_run_spec",
      category: "validation",
      message: issues[0]?.message || "Invalid GrokRunSpec",
      correctiveAction: "Correct the run contract and recompile it before requesting launch.",
      issues,
    });
  }
  return deepFreeze(parsed.data);
}

export function compileGrokRunSpec(
  input: unknown,
  snapshot: GrokCapabilitySnapshot
): CompiledGrokRun {
  const spec = parseGrokRunSpec(input);
  if (
    snapshot.schemaVersion !== spec.capabilitySnapshot.version ||
    snapshot.fingerprint !== spec.capabilitySnapshot.fingerprint ||
    !sameExecutable(snapshot.command, spec.command) ||
    !samePath(snapshot.cwd, spec.cwd)
  ) {
    throw new GrokRunSpecError({
      code: "capability_snapshot_mismatch",
      category: "capability",
      message: "The run spec does not match the current Grok capability snapshot.",
      correctiveAction: "Rerun capability preflight in the exact trusted cwd and rebuild the run spec.",
    });
  }

  const args = compileArgs(spec);
  const required = new Set<GrokCapabilityId>(["inspect_json"]);
  for (const capability of inferGrokCapabilitiesFromArgs(args)) required.add(capability);
  if (spec.execution.leaderSocket) required.add("leader_health_json");
  const requiredCapabilities = [...required];
  const compatibility = checkGrokCompatibility(snapshot, requiredCapabilities);
  if (!compatibility.ok) {
    throw new GrokRunSpecError({
      code: "unsupported_capability",
      category: "capability",
      message: "The installed Grok CLI cannot satisfy this run contract.",
      correctiveAction:
        compatibility.correctiveAction || "Repair Grok capability preflight and rebuild the run spec.",
      issues: [
        ...compatibility.unsupported.map((value) => ({ path: "capabilities", message: `${value} is unsupported` })),
        ...compatibility.unknown.map((value) => ({ path: "capabilities", message: `${value} support is unknown` })),
      ],
    });
  }

  const argvPreview = redactArgv(spec, args);
  const receipt: GrokRunReceipt = {
    version: GROK_RUN_SPEC_VERSION,
    runSpecId: spec.id,
    capabilitySnapshot: { ...spec.capabilitySnapshot },
    command: spec.command,
    cwd: spec.cwd,
    role: spec.role,
    unattended: spec.unattended,
    workspace: spec.workspace,
    session: spec.session,
    prompt: {
      transport: spec.prompt.transport,
      sha256: spec.prompt.sha256,
      bytes: spec.prompt.bytes,
      ...(spec.prompt.transport === "file"
        ? {
            path: spec.prompt.path,
            artifactId: spec.prompt.artifactId,
            ephemeral: spec.prompt.ephemeral,
          }
        : {}),
    },
    execution: spec.execution,
    output:
      spec.output.mode === "report"
        ? {
            mode: spec.output.mode,
            format: spec.output.format,
            schemaHash: spec.output.schemaHash,
            schemaBytes: spec.output.schemaBytes,
          }
        : { mode: spec.output.mode, format: spec.output.format },
    debug: spec.debug,
    requiredCapabilities,
    argvHash: hashGrokRunContent(JSON.stringify([spec.command, ...args])),
    argvPreview,
  };

  return deepFreeze({ spec, command: spec.command, args, cwd: spec.cwd, receipt });
}

export function formatGrokRunReceipt(receipt: GrokRunReceipt): string {
  return [
    `GrokRunSpec v${receipt.version} ${receipt.runSpecId}`,
    `role=${receipt.role} unattended=${receipt.unattended}`,
    `cwd=${receipt.cwd}`,
    `capabilities=${receipt.capabilitySnapshot.fingerprint}`,
    `prompt=${receipt.prompt.transport}:${receipt.prompt.sha256} (${receipt.prompt.bytes} bytes)`,
    `argv=${JSON.stringify([receipt.command, ...receipt.argvPreview])}`,
  ].join("\n");
}

function compileArgs(spec: GrokRunSpec): string[] {
  const args: string[] = [];
  if (spec.execution.model) args.push("--model", spec.execution.model);
  if (spec.execution.agent) args.push("--agent", spec.execution.agent);
  args.push("--reasoning-effort", spec.execution.reasoningEffort);
  args.push("--max-turns", String(spec.execution.maxTurns));
  if (spec.execution.tools.allow.length > 0) {
    args.push("--tools", spec.execution.tools.allow.join(","));
  }
  if (spec.execution.tools.deny.length > 0) {
    args.push("--disallowed-tools", spec.execution.tools.deny.join(","));
  }
  if (spec.execution.webSearch === "disabled") args.push("--disable-web-search");
  if (spec.execution.alwaysApprove) args.push("--always-approve");
  if (spec.execution.permissionMode) args.push("--permission-mode", spec.execution.permissionMode);
  if (spec.execution.sandbox) args.push("--sandbox", spec.execution.sandbox);
  if (spec.execution.delegation.mode === "deny") args.push("--no-subagents");
  if (spec.execution.noMemory) args.push("--no-memory");
  if (spec.execution.noPlan) args.push("--no-plan");
  if (spec.execution.check) args.push("--check");
  if (spec.execution.leaderSocket) args.push("--leader-socket", spec.execution.leaderSocket);

  if (spec.workspace.kind === "native_create") {
    args.push("--worktree", spec.workspace.name);
    if (spec.workspace.ref) args.push("--worktree-ref", spec.workspace.ref);
  }

  switch (spec.session.intent) {
    case "new":
      if (spec.session.sessionId) args.push("--session-id", spec.session.sessionId);
      break;
    case "resume":
      args.push("--resume", spec.session.sessionId);
      break;
    case "fork":
      args.push("--resume", spec.session.sourceSessionId, "--fork-session");
      if (spec.session.newSessionId) args.push("--session-id", spec.session.newSessionId);
      break;
    case "continue_latest":
      args.push("--continue");
      break;
  }

  args.push("--output-format", spec.output.format);
  if (spec.output.mode === "report") args.push("--json-schema", spec.output.schema);
  if (spec.debug.retention !== "none") args.push("--debug-file", spec.debug.file);

  switch (spec.prompt.transport) {
    case "file":
      args.push("--prompt-file", spec.prompt.path);
      break;
    case "json":
      args.push("--prompt-json", spec.prompt.value);
      break;
    case "inline":
      args.push("--prompt", spec.prompt.value);
      break;
  }
  return args;
}

function redactArgv(spec: GrokRunSpec, args: readonly string[]): string[] {
  const preview: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    preview.push(value);
    if (value === "--prompt-json" || value === "--prompt") {
      preview.push(`<${spec.prompt.transport}-prompt sha256=${spec.prompt.sha256} bytes=${spec.prompt.bytes}>`);
      index += 1;
    } else if (value === "--json-schema" && spec.output.mode === "report") {
      preview.push(`<json-schema sha256=${spec.output.schemaHash} bytes=${spec.output.schemaBytes}>`);
      index += 1;
    }
  }
  return preview.map((value) => redactSecrets(value).text);
}

function validatePinnedContent(
  value: string,
  expectedHash: string,
  expectedBytes: number,
  issuePath: PropertyKey[],
  ctx: z.RefinementCtx
): void {
  if (Buffer.byteLength(value, "utf8") !== expectedBytes) {
    ctx.addIssue({ code: "custom", path: [...issuePath, "bytes"], message: "does not match UTF-8 content size" });
  }
  if (hashGrokRunContent(value) !== expectedHash.toLowerCase()) {
    ctx.addIssue({ code: "custom", path: [...issuePath, "sha256"], message: "does not match content" });
  }
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left).replace(/\\/g, "/").replace(/\/$/, "");
  const b = path.resolve(right).replace(/\\/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameExecutable(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
