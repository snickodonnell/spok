import { nanoid } from "nanoid";
import type { DiffStatus, StreamEvent, StreamEventProvider } from "./types";
import {
  makeUnknownEvent,
  parseStreamEvent,
  stampStreamEvent,
} from "./stream-event-schema";
import {
  isNonThoughtContent,
  isStreamingContinuation,
  isSystemPromptNoise,
  isTechnicalCliNoise,
  mergeStreamingText,
} from "./trace-text";

export { isSystemPromptNoise, isTechnicalCliNoise } from "./trace-text";

/**
 * Parse Grok Build `--output-format streaming-json` lines and Spok harness envelopes
 * into user-friendly StreamEvents.
 *
 * Grok streams ACP-style messages:
 * {
 *   method: "session/update",
 *   params: {
 *     update: {
 *       sessionUpdate: "agent_thought_chunk" | "agent_message_chunk" | "tool_call" | ...
 *       content, toolCallId, title, rawInput, ...
 *     }
 *   }
 * }
 */

export type IngestResult = {
  events: StreamEvent[];
  /** Human-readable log line for the raw log panel */
  logLine?: string;
  /** Original raw line when useful for durable raw log */
  rawLine?: string;
};

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

/**
 * Pull human-readable text out of Grok/ACP content shapes.
 * Handles strings, {type:"text",text}, {data:"..."}, nested content, arrays.
 * Never returns a useless key-list like "{ type, data }".
 */
function textFromContent(content: unknown, depth = 0): string {
  if (content == null || depth > 6) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  if (Array.isArray(content)) {
    return content
      .map((c) => textFromContent(c, depth + 1))
      .filter(Boolean)
      .join("");
  }
  const o = asObj(content);
  if (!o) return "";

  // Prefer explicit text fields (order matters)
  for (const key of [
    "text",
    "message",
    "content",
    "thinking",
    "thought",
    "reasoning",
    "delta",
    "output",
    "value",
    "data",
  ]) {
    const v = o[key];
    if (typeof v === "string" && v.length) return v;
    if (v && typeof v === "object") {
      const nested = textFromContent(v, depth + 1);
      if (nested) return nested;
    }
  }

  // ACP-style typed parts without nested walk above
  if (o.type === "diff") {
    const path = String(o.path ?? "file");
    return `Diff: ${path}`;
  }

  return "";
}

/** Extract usable prose from a raw JSON object (stdout line). */
function extractProseFromJson(obj: Json): string {
  // Harness envelope
  if (
    (obj.type === "stdout" || obj.type === "stderr") &&
    typeof obj.data === "string"
  ) {
    return "";
  }
  const direct = textFromContent(obj);
  if (direct) return direct;
  if (typeof obj.data === "string") return obj.data;
  if (asObj(obj.data)) return textFromContent(obj.data);
  if (asObj(obj.params)) {
    const update = asObj(asObj(obj.params)?.update);
    if (update) return textFromContent(update.content ?? update);
  }
  return "";
}

/**
 * Grok streaming-json uses type names like "thought" and "text".
 * Note: "thought".includes("think") is FALSE — must match explicitly.
 */
function isThoughtEventType(type: string): boolean {
  const t = type.toLowerCase().replace(/-/g, "_");
  return (
    t === "thought" ||
    t === "thoughts" ||
    t === "thinking" ||
    t === "reasoning" ||
    t === "agent_thought" ||
    t === "agent_thinking" ||
    t === "thought_delta" ||
    t === "thinking_delta" ||
    t === "reasoning_delta" ||
    t.endsWith("_thought") ||
    t.endsWith("_thinking") ||
    t.includes("thought_chunk") ||
    t.includes("thinking_chunk")
  );
}

function isAgentTextEventType(type: string): boolean {
  const t = type.toLowerCase().replace(/-/g, "_");
  return (
    t === "text" ||
    t === "message" ||
    t === "assistant" ||
    t === "assistant_message" ||
    t === "agent_message" ||
    t === "output_text" ||
    t === "content" ||
    t === "response" ||
    t === "response_chunk" ||
    t === "message_delta" ||
    t === "text_delta" ||
    t.includes("message_chunk")
  );
}

function isThoughtSessionUpdate(kind: string): boolean {
  const k = kind.toLowerCase().replace(/-/g, "_");
  return (
    k === "agent_thought_chunk" ||
    k === "agent_thought" ||
    k === "thought_chunk" ||
    k === "thinking_chunk" ||
    k === "agent_thinking_chunk" ||
    k.includes("thought") ||
    k.includes("thinking") ||
    k.includes("reasoning")
  );
}

function tsOf(obj: Json, fallback = Date.now()): number {
  if (typeof obj.timestamp === "number") {
    // Grok sometimes uses seconds-like big ints; treat as ms if huge
    const t = obj.timestamp;
    return t < 1e12 ? t * 1000 : t;
  }
  if (typeof obj.ts === "string") {
    const p = Date.parse(obj.ts);
    if (!Number.isNaN(p)) return p;
  }
  const meta = asObj(obj._meta);
  if (meta && typeof meta.agentTimestampMs === "number") return meta.agentTimestampMs;
  return fallback;
}

function toolNameFromUpdate(update: Json): string {
  const meta = asObj(update._meta);
  const xai = meta ? asObj(meta["x.ai/tool"]) : null;
  if (xai && typeof xai.name === "string") return xai.name;
  if (typeof update.title === "string" && update.title && !update.title.includes(" ")) {
    return update.title;
  }
  if (typeof update.title === "string") {
    // "Write `path`" → write
    const m = update.title.match(/^(Write|Edit|Read|List|Delete|Run)\b/i);
    if (m) return m[1].toLowerCase() === "write" ? "write" : m[1].toLowerCase();
  }
  return typeof update.title === "string" ? update.title : "tool";
}

function pathFromUpdate(update: Json): string | undefined {
  const raw = asObj(update.rawInput);
  if (raw) {
    for (const k of [
      "file_path",
      "path",
      "target_file",
      "target_directory",
      "old_path",
      "new_path",
    ]) {
      if (typeof raw[k] === "string" && raw[k]) return String(raw[k]);
    }
  }
  const locs = update.locations;
  if (Array.isArray(locs) && locs[0]) {
    const p = asObj(locs[0]);
    if (p && typeof p.path === "string") return p.path;
  }
  const content = update.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      const o = asObj(c);
      if (o && typeof o.path === "string") return o.path;
    }
  }
  // Title like Write `C:\dev\...`
  if (typeof update.title === "string") {
    const m = update.title.match(/`([^`]+)`/);
    if (m) return m[1];
  }
  return undefined;
}

function relPath(p: string | undefined, cwd?: string): string | undefined {
  if (!p) return undefined;
  let out = p.replace(/\\/g, "/");
  if (cwd) {
    const c = cwd.replace(/\\/g, "/").replace(/\/$/, "");
    if (out.toLowerCase().startsWith(c.toLowerCase() + "/")) {
      out = out.slice(c.length + 1);
    }
  }
  return out;
}

function diffsFromContent(
  content: unknown,
  cwd?: string
): Array<{ path: string; oldContent: string; newContent: string }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ path: string; oldContent: string; newContent: string }> = [];
  for (const c of content) {
    const o = asObj(c);
    if (!o || o.type !== "diff") continue;
    const path = relPath(String(o.path ?? ""), cwd);
    if (!path) continue;
    out.push({
      path,
      oldContent: typeof o.oldText === "string" ? o.oldText : "",
      newContent: typeof o.newText === "string" ? o.newText : "",
    });
  }
  return out;
}

/**
 * Stateful coalescer: merges consecutive thought/message chunks into single nodes.
 */
export class GrokStreamIngestor {
  private thoughtId: string | null = null;
  private thoughtText = "";
  private messageId: string | null = null;
  private messageText = "";
  private toolNodes = new Map<string, string>(); // toolCallId → trace node id
  private cwd: string;
  private rawSeq = 0;

  constructor(cwd = "") {
    this.cwd = cwd;
  }

  setCwd(cwd: string) {
    this.cwd = cwd;
  }

  /** Reset coalescing at end of a run */
  resetTurn() {
    this.thoughtId = null;
    this.thoughtText = "";
    this.messageId = null;
    this.messageText = "";
  }

  private nextRawId(): string {
    this.rawSeq += 1;
    return `raw-${this.rawSeq}`;
  }

  private finalize(
    events: StreamEvent[],
    provider: StreamEventProvider,
    logLine?: string,
    rawLine?: string
  ): IngestResult {
    const stamped = events.map((ev) =>
      stampStreamEvent(ev, {
        provider: ev.provider ?? provider,
        rawEventId: ev.rawEventId ?? this.nextRawId(),
      })
    );
    return { events: stamped, logLine, rawLine };
  }

  ingestLine(line: string, timestamp = Date.now()): IngestResult {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return { events: [] };

    // Harness NDJSON envelope from /api/session/start
    try {
      const env = JSON.parse(trimmed) as Json;
      if (env.type === "stdout" || env.type === "stderr") {
        const data = String(env.data ?? "");
        const events: StreamEvent[] = [];
        let lastLog: string | undefined;
        for (const sub of data.split("\n")) {
          if (!sub.trim()) continue;
          const r = this.ingestPayloadLine(sub, timestamp);
          events.push(...r.events);
          if (r.logLine) lastLog = r.logLine;
        }
        return this.finalize(
          events,
          "grok",
          env.type === "stderr"
            ? `[stderr] ${lastLog ?? data.slice(0, 200)}`
            : lastLog,
          trimmed
        );
      }
      if (env.type === "event" && env.event) {
        const parsed = parseStreamEvent(env.event, {
          timestamp,
          provider: "harness",
        });
        if (parsed.ok) {
          return this.finalize(
            [parsed.event],
            "harness",
            formatLogFromEvent(parsed.event),
            trimmed
          );
        }
        const fallback = stampStreamEvent(env.event as StreamEvent, {
          provider: "harness",
        });
        return this.finalize(
          [fallback],
          "harness",
          formatLogFromEvent(fallback),
          trimmed
        );
      }
      if (env.type === "exit") {
        const code = typeof env.code === "number" ? env.code : null;
        const ok = code === 0;
        const ev: StreamEvent = {
          type: "system",
          timestamp,
          id: nanoid(10),
          title: ok ? "Run complete" : "Run failed",
          content: `Process exited with code ${code}`,
          status: ok ? "success" : "error",
          severity: ok ? "info" : "runtime",
          provider: "harness",
          meta: { exitCode: code, signal: env.signal },
        };
        return this.finalize([ev], "harness", ev.content, trimmed);
      }
      // Fall through — might be a Grok stream line itself
      return this.ingestPayloadLine(trimmed, timestamp);
    } catch {
      // Not JSON envelope — try payload / plain text
      return this.ingestPayloadLine(trimmed, timestamp);
    }
  }

  private ingestPayloadLine(line: string, timestamp: number): IngestResult {
    const trimmed = line.trim();
    if (!trimmed) return { events: [] };

    let obj: Json;
    try {
      obj = JSON.parse(trimmed) as Json;
    } catch {
      // plain text — never promote CLI/Git noise to thinking/message prose
      if (isTechnicalCliNoise(trimmed) || isSystemPromptNoise(trimmed)) {
        return this.finalize(
          [
            {
              type: "system",
              timestamp,
              id: nanoid(10),
              title: "CLI output",
              content: trimmed,
              status: "success",
              provider: "grok",
              severity: "debug",
            },
          ],
          "grok",
          trimmed.slice(0, 300),
          trimmed
        );
      }
      return this.finalize(
        [
          {
            type: "message",
            timestamp,
            id: nanoid(10),
            title: "Output",
            content: trimmed,
            status: "success",
            provider: "grok",
          },
        ],
        "grok",
        trimmed.slice(0, 300),
        trimmed
      );
    }

    // Spok / Grok native event with type field (content may live in data/text)
    if (
      typeof obj.type === "string" &&
      [
        "thinking",
        "reasoning",
        "tool_call",
        "tool_result",
        "file_change",
        "message",
        "system",
        "error",
        "goal",
        "plan",
        "parser_error",
        "session_start",
        "session_end",
        "diff",
      ].includes(obj.type) &&
      !obj.method
    ) {
      const prose =
        textFromContent(obj.content) ||
        textFromContent(obj.data) ||
        (typeof obj.text === "string" ? obj.text : "") ||
        (typeof obj.message === "string" ? obj.message : "");

      // Never surface system-prompt dumps as thinking
      if (
        (obj.type === "thinking" || obj.type === "reasoning") &&
        isSystemPromptNoise(prose)
      ) {
        return this.finalize([], "spok", undefined, trimmed);
      }

      const normalized = {
        ...obj,
        content: prose || String(obj.content ?? ""),
        title:
          typeof obj.title === "string"
            ? obj.title
            : obj.type === "thinking"
              ? "Thinking"
              : undefined,
      };
      const parsed = parseStreamEvent(normalized, {
        timestamp,
        provider: "spok",
      });
      if (parsed.ok) {
        return this.finalize(
          [parsed.event],
          "spok",
          formatLogFromEvent(parsed.event),
          trimmed
        );
      }
      // Soft stamp — still prefer extracted prose over empty content
      const soft = stampStreamEvent(
        {
          ...(normalized as unknown as StreamEvent),
          type: obj.type as StreamEvent["type"],
          timestamp:
            typeof obj.timestamp === "number" ? obj.timestamp : timestamp,
          id: typeof obj.id === "string" ? obj.id : nanoid(10),
          content: prose,
          meta: {
            ...(typeof obj.meta === "object" && obj.meta
              ? (obj.meta as Record<string, unknown>)
              : {}),
            softParse: true,
            parseNote: parsed.error,
            raw: obj,
          },
        },
        { provider: "spok" }
      );
      return this.finalize([soft], "spok", formatLogFromEvent(soft), trimmed);
    }

    // Grok ACP session/update (preferred structured path)
    if (obj.method === "session/update" || asObj(obj.params)?.update) {
      const r = this.ingestSessionUpdate(obj, timestamp);
      return this.finalize(r.events, "grok", r.logLine, trimmed);
    }

    // Grok streaming-json typed events: { type: "thought"|"text"|..., text|data|content }
    // These are what show up in the raw log as bare "thought" / "text" when mis-handled.
    if (typeof obj.type === "string" && !obj.method) {
      const tname = String(obj.type);
      const prose = extractProseFromJson(obj);

      if (prose && isThoughtEventType(tname)) {
        return this.finalize(
          this.appendThoughtProse(prose, timestamp),
          "grok",
          prose.slice(0, 240),
          trimmed
        );
      }

      if (prose && isAgentTextEventType(tname)) {
        return this.finalize(
          this.appendMessageProse(prose, timestamp),
          "grok",
          prose.slice(0, 240),
          trimmed
        );
      }

      // Known harness lifecycle types
      const r = this.ingestGrokEvent(obj, timestamp);
      return this.finalize(r.events, "grok", r.logLine, trimmed);
    }

    // Unknown JSON — preserve raw payload in meta, never drop
    const unknown = makeUnknownEvent({
      summary: summarizeUnknownJson(obj),
      raw: obj,
      timestamp,
      provider: "unknown",
    });
    return this.finalize(
      [unknown],
      "unknown",
      summarizeUnknownJson(obj),
      trimmed
    );
  }

  private ingestSessionUpdate(obj: Json, timestamp: number): IngestResult {
    const params = asObj(obj.params) ?? {};
    const update = asObj(params.update) ?? asObj(obj.update) ?? {};
    const kind = String(update.sessionUpdate ?? "");
    const t = tsOf(obj, timestamp);
    const events: StreamEvent[] = [];

    switch (kind) {
      case "user_message_chunk": {
        const text = textFromContent(update.content);
        if (text) {
          events.push({
            type: "goal",
            timestamp: t,
            id: nanoid(10),
            title: "You",
            content: text,
            status: "success",
          });
        }
        break;
      }

      case "agent_thought_chunk":
      case "agent_thought":
      case "thought_chunk":
      case "thinking_chunk":
      case "agent_thinking_chunk": {
        const chunk = textFromContent(update.content);
        events.push(...this.appendThoughtProse(chunk, t));
        break;
      }

      case "agent_message_chunk":
      case "agent_message":
      case "message_chunk": {
        const chunk = textFromContent(update.content);
        events.push(...this.appendMessageProse(chunk, t));
        break;
      }

      case "tool_call": {
        // Finalize open thought/message
        this.flushOpenText(events, t);
        const toolCallId = String(update.toolCallId ?? nanoid(10));
        const name = toolNameFromUpdate(update);
        const nodeId = nanoid(10);
        this.toolNodes.set(toolCallId, nodeId);
        const path = relPath(pathFromUpdate(update), this.cwd);
        const raw = asObj(update.rawInput);
        const inputPreview = raw
          ? JSON.stringify(raw, null, 0).slice(0, 400)
          : "";
        const humanTitle = path
          ? `${name} · ${path}`
          : typeof update.title === "string" && update.title
            ? update.title
            : name;
        events.push({
          type: "tool_call",
          timestamp: t,
          id: nodeId,
          title: humanTitle,
          // Prefer human title for content; keep raw input in meta for Log / technical panel
          content: humanTitle,
          summary: path || name,
          toolName: name,
          path,
          status: "running",
          meta: {
            toolCallId,
            rawInput: raw ?? undefined,
            path: path ?? undefined,
            inputPreview: inputPreview || undefined,
          },
        });

        // write/search_replace may include content in rawInput
        if (
          (name === "write" || name === "search_replace") &&
          path &&
          raw &&
          typeof raw.content === "string"
        ) {
          events.push({
            type: "file_change",
            timestamp: t,
            id: nanoid(10),
            parentId: nodeId,
            title: `File: ${path}`,
            content: `${name === "write" ? "Wrote" : "Edited"} ${path}`,
            path,
            oldContent: typeof raw.old_string === "string" ? "" : "",
            newContent: String(raw.content),
            diffStatus: "modified" as DiffStatus,
            status: "success",
          });
        }
        break;
      }

      case "tool_call_update": {
        const toolCallId = String(update.toolCallId ?? "");
        const nodeId = this.toolNodes.get(toolCallId) ?? nanoid(10);
        const name = toolNameFromUpdate(update);
        const path = relPath(pathFromUpdate(update), this.cwd);
        const statusMeta = asObj(asObj(update._meta)?.updateParams);
        const st = statusMeta?.status;
        const status: StreamEvent["status"] =
          st === "Failed" || st === "error"
            ? "error"
            : st === "Completed" || st === "success"
              ? "success"
              : "running";

        const contentBits: string[] = [];
        if (typeof update.title === "string") contentBits.push(update.title);
        const text = textFromContent(update.content);
        if (text && !text.startsWith("Diff:")) contentBits.push(text);

        const resultText = contentBits.join("\n").trim();
        const human =
          path != null
            ? `${name} · ${path}`
            : typeof update.title === "string" && update.title
              ? update.title
              : name;
        events.push({
          type: status === "running" ? "tool_call" : "tool_result",
          timestamp: t,
          id: nodeId,
          title: human,
          // Readable summary first; full result body when present (not raw tool wire format)
          content:
            resultText && !resultText.startsWith("{")
              ? resultText
              : human,
          summary: path || resultText.slice(0, 140) || name,
          toolName: name,
          path,
          status: status === "running" ? "running" : status,
          meta: {
            toolCallId,
            path: path ?? undefined,
            rawResult: resultText || undefined,
          },
        });

        // Diffs attached to tool updates (write results)
        for (const d of diffsFromContent(update.content, this.cwd)) {
          events.push({
            type: "file_change",
            timestamp: t,
            id: nanoid(10),
            parentId: nodeId,
            title: `File: ${d.path}`,
            content: `Changed ${d.path}`,
            path: d.path,
            oldContent: d.oldContent,
            newContent: d.newContent,
            diffStatus: (!d.oldContent && d.newContent
              ? "added"
              : d.oldContent && !d.newContent
                ? "deleted"
                : "modified") as DiffStatus,
            status: "success",
          });
        }

        // rawInput with full content for write
        const raw = asObj(update.rawInput);
        if (
          path &&
          raw &&
          typeof raw.content === "string" &&
          (name === "write" || String(update.kind) === "edit")
        ) {
          const already = diffsFromContent(update.content, this.cwd).some(
            (d) => d.path === path
          );
          if (!already) {
            events.push({
              type: "file_change",
              timestamp: t,
              id: nanoid(10),
              parentId: nodeId,
              title: `File: ${path}`,
              content: `Wrote ${path}`,
              path,
              oldContent: "",
              newContent: String(raw.content),
              diffStatus: "added",
              status: "success",
            });
          }
        }
        break;
      }

      case "turn_completed":
      case "task_completed": {
        this.flushOpenText(events, t, true);
        const summary =
          textFromContent(update.content) ||
          (kind === "task_completed" ? "Task completed" : "Turn completed");
        events.push({
          type: "system",
          timestamp: t,
          id: nanoid(10),
          title: kind === "task_completed" ? "Task complete" : "Turn complete",
          content: summary,
          status: "success",
        });
        this.resetTurn();
        break;
      }

      case "task_backgrounded": {
        events.push({
          type: "system",
          timestamp: t,
          id: nanoid(10),
          title: "Backgrounded",
          content: textFromContent(update.content) || "Task moved to background",
          status: "success",
        });
        break;
      }

      default: {
        if (!kind) break;
        // Catch any other thought/text sessionUpdate variants Grok may emit
        if (isThoughtSessionUpdate(kind)) {
          const chunk = textFromContent(update.content);
          events.push(...this.appendThoughtProse(chunk, t));
          break;
        }
        if (
          kind.toLowerCase().includes("message") ||
          kind.toLowerCase().includes("text")
        ) {
          const chunk = textFromContent(update.content);
          events.push(...this.appendMessageProse(chunk, t));
          break;
        }
        events.push({
          type: "system",
          timestamp: t,
          id: nanoid(10),
          title: humanizeSessionUpdate(kind),
          content: textFromContent(update.content) || kind,
          status: "success",
          meta: { sessionUpdate: kind },
        });
      }
    }

    const logLine =
      events.length > 0
        ? formatLogFromEvent(events[events.length - 1])
        : undefined;
    return { events, logLine };
  }

  private ingestGrokEvent(obj: Json, timestamp: number): IngestResult {
    const type = String(obj.type);
    const t = tsOf(obj, timestamp);
    if (type === "turn_started") {
      this.resetTurn();
      return {
        events: [
          {
            type: "system",
            timestamp: t,
            id: nanoid(10),
            title: "Turn started",
            content: `Model: ${obj.model_id ?? "—"} · session ${String(obj.session_id ?? "").slice(0, 8)}`,
            status: "running",
          },
        ],
        logLine: `Turn started (${obj.model_id ?? "model"})`,
      };
    }
    if (type === "phase_changed") {
      return {
        events: [
          {
            type: "system",
            timestamp: t,
            id: nanoid(10),
            title: "Phase",
            content: humanizeSessionUpdate(String(obj.phase ?? "")),
            status: "running",
          },
        ],
        logLine: `Phase: ${obj.phase}`,
      };
    }
    if (type === "loop_started") {
      return { events: [], logLine: `Loop ${obj.loop_index}` };
    }
    return {
      events: [
        {
          type: "system",
          timestamp: t,
          id: nanoid(10),
          title: humanizeSessionUpdate(type),
          content: summarizeUnknownJson(obj),
          status: "success",
        },
      ],
      logLine: type,
    };
  }

  private flushOpenText(
    events: StreamEvent[],
    t: number,
    _finalize = false // reserved for end-of-stream seal semantics
  ) {
    void _finalize;
    // Seal open buffers as permanent segments (never discarded when the
    // next tool/phase starts — terminal Grok clears these; Spok keeps them).
    if (this.thoughtId && this.thoughtText) {
      if (!isNonThoughtContent(this.thoughtText)) {
        events.push({
          type: "thinking",
          timestamp: t,
          id: this.thoughtId,
          title: "Thinking",
          content: this.thoughtText,
          summary: this.thoughtText.slice(0, 140),
          status: "success",
          meta: { permanent: true },
        });
      }
      this.thoughtId = null;
      this.thoughtText = "";
    }
    if (this.messageId && this.messageText) {
      if (!isTechnicalCliNoise(this.messageText)) {
        events.push({
          type: "message",
          timestamp: t,
          id: this.messageId,
          title: "Progress",
          content: this.messageText,
          summary: this.messageText.slice(0, 140),
          status: "success",
          meta: { permanent: true, progress: true },
        });
      }
      this.messageId = null;
      this.messageText = "";
    }
  }

  /**
   * Append prose into the current thought segment (or start one).
   * Shared by ACP thought chunks and raw {type:"thought", text} events.
   */
  private appendThoughtProse(chunk: string, t: number): StreamEvent[] {
    if (!chunk) return [];
    if (isNonThoughtContent(chunk)) {
      if (isTechnicalCliNoise(chunk)) {
        return [
          {
            type: "system",
            timestamp: t,
            id: nanoid(10),
            title: "CLI output",
            content: chunk,
            status: "success",
            severity: "debug",
          },
        ];
      }
      return [];
    }

    const next = this.thoughtText ? mergeChunk(this.thoughtText, chunk) : chunk;
    if (isNonThoughtContent(next) && !next.includes("\n")) {
      this.thoughtText = "";
      this.thoughtId = null;
      return [];
    }

    this.thoughtText = next;
    if (!this.thoughtId) this.thoughtId = nanoid(10);
    // New thought phase: close open message so progress lines stay permanent
    this.messageId = null;
    this.messageText = "";

    return [
      {
        type: "thinking",
        timestamp: t,
        id: this.thoughtId,
        title: "Thinking",
        content: this.thoughtText,
        summary: this.thoughtText.slice(0, 140),
        status: "running",
        meta: { permanent: true },
      },
    ];
  }

  /**
   * Append prose into the current message/progress segment.
   * Seals prior progress when the CLI would "clear and replace" the status line.
   */
  private appendMessageProse(chunk: string, t: number): StreamEvent[] {
    if (!chunk || isSystemPromptNoise(chunk)) return [];

    const events: StreamEvent[] = [];

    // Seal open thinking before message work
    if (
      this.thoughtId &&
      this.thoughtText &&
      !isNonThoughtContent(this.thoughtText)
    ) {
      events.push({
        type: "thinking",
        timestamp: t,
        id: this.thoughtId,
        title: "Thinking",
        content: this.thoughtText,
        summary: this.thoughtText.slice(0, 140),
        status: "success",
        meta: { permanent: true },
      });
      this.thoughtId = null;
      this.thoughtText = "";
    } else {
      this.thoughtId = null;
      this.thoughtText = "";
    }

    if (isTechnicalCliNoise(chunk)) {
      events.push({
        type: "system",
        timestamp: t,
        id: nanoid(10),
        title: "CLI output",
        content: chunk,
        status: "success",
        severity: "debug",
      });
      return events;
    }

    // Non-continuation → seal previous progress so history is not overwritten
    if (
      this.messageId &&
      this.messageText &&
      !isStreamingContinuation(this.messageText, chunk)
    ) {
      events.push({
        type: "message",
        timestamp: t,
        id: this.messageId,
        title: "Progress",
        content: this.messageText,
        summary: this.messageText.slice(0, 140),
        status: "success",
        meta: { permanent: true, progress: true },
      });
      this.messageId = null;
      this.messageText = "";
    }

    this.messageText = this.messageText
      ? mergeChunk(this.messageText, chunk)
      : chunk;
    if (!this.messageId) this.messageId = nanoid(10);
    events.push({
      type: "message",
      timestamp: t,
      id: this.messageId,
      title: "Grok",
      content: this.messageText,
      summary: this.messageText.slice(0, 140),
      status: "running",
      meta: { permanent: true },
    });
    return events;
  }
}

function mergeChunk(prev: string, chunk: string): string {
  return mergeStreamingText(prev, chunk);
}

function humanizeSessionUpdate(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || "Update";
}

function summarizeUnknownJson(obj: Json): string {
  const prose = extractProseFromJson(obj);
  if (prose && !isSystemPromptNoise(prose)) return prose.slice(0, 300);
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") return obj.error;
  // Prefer a short type label over "{ type, data }" key lists in the UI
  if (typeof obj.type === "string") return String(obj.type);
  const keys = Object.keys(obj).slice(0, 6).join(", ");
  return keys ? `event (${keys})` : "event";
}

export function formatLogFromEvent(ev: StreamEvent): string {
  const title = ev.title || ev.type;
  const body = (ev.content || "").replace(/\s+/g, " ").slice(0, 200);
  return body ? `${title}: ${body}` : title;
}

/**
 * Apply events to store with upsert semantics for same id (chunk coalescing).
 * Prefer a batched apply when the store exposes applyStreamEvents.
 */
export function applyEventsWithUpsert(
  applyStreamEvent: (
    sessionId: string,
    event: StreamEvent
  ) => void,
  sessionId: string,
  events: StreamEvent[],
  existingNodes: Record<string, { id: string }>,
  applyStreamEvents?: (sessionId: string, events: StreamEvent[]) => void
) {
  if (applyStreamEvents) {
    applyStreamEvents(sessionId, events);
  } else {
    for (const ev of events) {
      applyStreamEvent(sessionId, ev);
    }
  }
  void existingNodes;
}
