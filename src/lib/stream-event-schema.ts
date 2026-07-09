import { z } from "zod";
import { nanoid } from "nanoid";
import type {
  DiffStatus,
  StreamEvent,
  StreamEventProvider,
  StreamEventSeverity,
  StreamEventType,
  TraceLink,
} from "./types";

/** Current normalized StreamEvent schema version written by Spok. */
export const STREAM_EVENT_SCHEMA_VERSION = 1 as const;

export const STREAM_EVENT_TYPES = [
  "session_start",
  "session_end",
  "thinking",
  "reasoning",
  "tool_call",
  "tool_result",
  "plan",
  "plan_update",
  "subagent_start",
  "subagent_end",
  "message",
  "file_change",
  "diff",
  "error",
  "system",
  "goal",
  "raw",
  "parser_error",
] as const satisfies readonly StreamEventType[];

export const STREAM_EVENT_PROVIDERS = [
  "grok",
  "spok",
  "import",
  "harness",
  "unknown",
] as const satisfies readonly StreamEventProvider[];

const traceLinkSchema = z.object({
  kind: z.enum(["file", "hunk", "tool", "subagent", "plan"]),
  targetId: z.string(),
  label: z.string().optional(),
  path: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

const statusSchema = z.enum([
  "pending",
  "running",
  "success",
  "error",
  "skipped",
]);

const diffStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "unchanged",
]);

/**
 * Loose Zod schema for normalized StreamEvents.
 * Extra unknown keys are stripped at parse; callers should put provider data in `meta`.
 */
export const streamEventSchema = z.object({
  version: z.number().int().positive().optional(),
  type: z.enum(STREAM_EVENT_TYPES),
  timestamp: z.number(),
  sessionId: z.string().optional(),
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  toolName: z.string().optional(),
  status: statusSchema.optional(),
  path: z.string().optional(),
  oldPath: z.string().optional(),
  diffStatus: diffStatusSchema.optional(),
  oldContent: z.string().optional(),
  newContent: z.string().optional(),
  language: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  links: z.array(traceLinkSchema).optional(),
  subagentId: z.string().optional(),
  durationMs: z.number().optional(),
  provider: z.enum(STREAM_EVENT_PROVIDERS).optional(),
  rawEventId: z.string().optional(),
  runId: z.string().optional(),
  turnId: z.string().optional(),
  severity: z
    .enum(["debug", "info", "warn", "error", "parser", "runtime", "policy"])
    .optional(),
  redactions: z.number().int().nonnegative().optional(),
});

export type ParsedStreamEvent = z.infer<typeof streamEventSchema>;

export type StreamEventParseResult =
  | { ok: true; event: StreamEvent }
  | { ok: false; error: string; raw: unknown };

/** Normalize timestamps that may be seconds or milliseconds. */
export function normalizeTimestamp(ts: unknown, fallback = Date.now()): number {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return fallback;
  // Treat values below 1e12 as seconds (year ~2001 in ms is 1e12)
  return ts > 0 && ts < 1e12 ? Math.round(ts * 1000) : ts;
}

/**
 * Coerce unknown input into a versioned StreamEvent.
 * Returns a parse error result when the shape is not a stream event at all.
 */
export function parseStreamEvent(
  input: unknown,
  defaults?: {
    timestamp?: number;
    provider?: StreamEventProvider;
    sessionId?: string;
    runId?: string;
    turnId?: string;
  }
): StreamEventParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Event must be an object", raw: input };
  }

  const obj = input as Record<string, unknown>;
  const typeRaw = obj.type;
  if (typeof typeRaw !== "string") {
    return { ok: false, error: "Event missing type", raw: input };
  }

  // Map legacy / unknown type strings conservatively
  const type = typeRaw as StreamEventType;
  if (!(STREAM_EVENT_TYPES as readonly string[]).includes(typeRaw)) {
    // Not a Spok stream type — caller may still want a diagnostic
    return {
      ok: false,
      error: `Unknown stream event type: ${typeRaw}`,
      raw: input,
    };
  }

  const ts = normalizeTimestamp(
    obj.timestamp ?? defaults?.timestamp,
    defaults?.timestamp ?? Date.now()
  );

  const candidate = {
    ...obj,
    type,
    timestamp: ts,
    version:
      typeof obj.version === "number"
        ? obj.version
        : STREAM_EVENT_SCHEMA_VERSION,
    id: typeof obj.id === "string" && obj.id ? obj.id : nanoid(10),
    provider:
      (obj.provider as StreamEventProvider | undefined) ??
      defaults?.provider ??
      "spok",
    sessionId:
      typeof obj.sessionId === "string"
        ? obj.sessionId
        : defaults?.sessionId,
    runId: typeof obj.runId === "string" ? obj.runId : defaults?.runId,
    turnId: typeof obj.turnId === "string" ? obj.turnId : defaults?.turnId,
  };

  const parsed = streamEventSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; ") || "Invalid event",
      raw: input,
    };
  }

  return { ok: true, event: parsed.data as StreamEvent };
}

/**
 * Stamp required Phase-1 fields onto an already-shaped StreamEvent.
 * Does not drop fields; safe to call on every ingress path.
 */
export function stampStreamEvent(
  event: StreamEvent,
  extras?: {
    provider?: StreamEventProvider;
    sessionId?: string;
    rawEventId?: string;
    runId?: string;
    turnId?: string;
    severity?: StreamEventSeverity;
  }
): StreamEvent {
  return {
    ...event,
    version: event.version ?? STREAM_EVENT_SCHEMA_VERSION,
    timestamp: normalizeTimestamp(event.timestamp),
    id: event.id || nanoid(10),
    provider: event.provider ?? extras?.provider ?? "spok",
    sessionId: event.sessionId ?? extras?.sessionId,
    rawEventId: event.rawEventId ?? extras?.rawEventId,
    runId: event.runId ?? extras?.runId,
    turnId: event.turnId ?? extras?.turnId,
    severity: event.severity ?? extras?.severity,
  };
}

/** Build a visible parser diagnostic event that preserves the raw payload. */
export function makeParserErrorEvent(opts: {
  message: string;
  raw?: unknown;
  timestamp?: number;
  sessionId?: string;
  provider?: StreamEventProvider;
  rawEventId?: string;
}): StreamEvent {
  const rawPreview =
    opts.raw === undefined
      ? undefined
      : typeof opts.raw === "string"
        ? opts.raw.slice(0, 2000)
        : safeJson(opts.raw).slice(0, 2000);

  return stampStreamEvent(
    {
      type: "parser_error",
      timestamp: opts.timestamp ?? Date.now(),
      title: "Parser error",
      content: opts.message + (rawPreview ? `\n\n${rawPreview}` : ""),
      summary: opts.message.slice(0, 140),
      status: "error",
      severity: "parser",
      provider: opts.provider ?? "spok",
      sessionId: opts.sessionId,
      meta: {
        parserError: true,
        message: opts.message,
        raw: opts.raw,
      },
    },
    { rawEventId: opts.rawEventId, severity: "parser" }
  );
}

/** Build a system event that preserves unknown JSON without dropping it. */
export function makeUnknownEvent(opts: {
  summary: string;
  raw: unknown;
  timestamp?: number;
  sessionId?: string;
  provider?: StreamEventProvider;
  rawEventId?: string;
}): StreamEvent {
  return stampStreamEvent(
    {
      type: "system",
      timestamp: opts.timestamp ?? Date.now(),
      title: "Unknown stream event",
      content: opts.summary,
      summary: opts.summary.slice(0, 140),
      status: "success",
      severity: "info",
      provider: opts.provider ?? "unknown",
      sessionId: opts.sessionId,
      meta: {
        unknown: true,
        raw: opts.raw,
      },
    },
    { rawEventId: opts.rawEventId }
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Migrate export/import event arrays that may lack version fields. */
export function migrateStreamEvents(
  events: unknown[],
  defaults?: { provider?: StreamEventProvider; sessionId?: string }
): { events: StreamEvent[]; errors: StreamEvent[] } {
  const out: StreamEvent[] = [];
  const errors: StreamEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const raw = events[i];
    const parsed = parseStreamEvent(raw, {
      provider: defaults?.provider ?? "import",
      sessionId: defaults?.sessionId,
    });
    if (parsed.ok) {
      out.push(parsed.event);
    } else {
      // If it looks like a partial event with content, attempt soft recovery
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        if (typeof o.type === "string" || typeof o.content === "string") {
          out.push(
            stampStreamEvent({
              type: (typeof o.type === "string" &&
              (STREAM_EVENT_TYPES as readonly string[]).includes(o.type)
                ? o.type
                : "message") as StreamEventType,
              timestamp: normalizeTimestamp(o.timestamp),
              title: typeof o.title === "string" ? o.title : "Imported event",
              content:
                typeof o.content === "string"
                  ? o.content
                  : safeJson(o).slice(0, 2000),
              status: "success",
              meta: { migrated: true, raw: o, parseError: parsed.error },
              provider: "import",
              path: typeof o.path === "string" ? o.path : undefined,
              toolName: typeof o.toolName === "string" ? o.toolName : undefined,
              diffStatus: o.diffStatus as DiffStatus | undefined,
              oldContent:
                typeof o.oldContent === "string" ? o.oldContent : undefined,
              newContent:
                typeof o.newContent === "string" ? o.newContent : undefined,
              links: o.links as TraceLink[] | undefined,
            })
          );
          continue;
        }
      }
      errors.push(
        makeParserErrorEvent({
          message: `Event[${i}]: ${parsed.error}`,
          raw,
          provider: "import",
          sessionId: defaults?.sessionId,
        })
      );
    }
  }
  return { events: out, errors };
}
