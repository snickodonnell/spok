import { nanoid } from "nanoid";
import type { StreamEvent, StreamEventType, TraceNodeType } from "./types";

/**
 * Parse Grok Build / agent CLI output into structured StreamEvents.
 * Supports NDJSON, common log prefixes, and free-form reasoning blocks.
 */

const TOOL_CALL_RE =
  /(?:tool[_ ]?call|calling|invoke[sd]?|using tool)[:\s]+[`"]?([a-zA-Z0-9_./-]+)[`"]?/i;
const TOOL_RESULT_RE = /(?:tool[_ ]?result|result for|completed tool)[:\s]+[`"]?([a-zA-Z0-9_./-]+)[`"]?/i;
const FILE_CHANGE_RE =
  /(?:(?:wrote|created|modified|updated|deleted|edited|patched)\s+(?:file\s+)?|file[_ ]change[:\s]+)[`"]?([^\s`"'<>]+)[`"]?/i;
const THINKING_RE = /^(?:thinking|reasoning|thought)[:\s]/i;
const PLAN_RE = /^(?:plan|todo|planning)[:\s]/i;
const SUBAGENT_RE = /(?:spawn(?:ed|ing)?\s+subagent|subagent[_ ](?:start|spawn))[:\s]*(.*)/i;
const ERROR_RE = /^(?:error|failed|exception)[:\s]/i;
const NDJSON_RE = /^\s*\{[\s\S]*\}\s*$/;

function detectType(line: string): StreamEventType {
  if (ERROR_RE.test(line)) return "error";
  if (SUBAGENT_RE.test(line)) return "subagent_start";
  if (PLAN_RE.test(line)) return "plan";
  if (THINKING_RE.test(line)) return "thinking";
  if (TOOL_RESULT_RE.test(line)) return "tool_result";
  if (TOOL_CALL_RE.test(line)) return "tool_call";
  if (FILE_CHANGE_RE.test(line)) return "file_change";
  if (/^\[system\]/i.test(line)) return "system";
  if (/^\[goal\]/i.test(line)) return "goal";
  return "message";
}

function typeToTitle(type: StreamEventType, line: string): string {
  switch (type) {
    case "thinking":
      return "Thinking";
    case "reasoning":
      return "Reasoning";
    case "tool_call": {
      const m = line.match(TOOL_CALL_RE);
      return m ? `Tool: ${m[1]}` : "Tool call";
    }
    case "tool_result": {
      const m = line.match(TOOL_RESULT_RE);
      return m ? `Result: ${m[1]}` : "Tool result";
    }
    case "plan":
    case "plan_update":
      return "Plan update";
    case "subagent_start":
      return "Subagent started";
    case "subagent_end":
      return "Subagent finished";
    case "file_change": {
      const m = line.match(FILE_CHANGE_RE);
      return m ? `File: ${m[1]}` : "File change";
    }
    case "error":
      return "Error";
    case "goal":
      return "Goal";
    case "system":
      return "System";
    default:
      return line.slice(0, 80) || "Message";
  }
}

export function parseNdjsonLine(line: string, timestamp = Date.now()): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !NDJSON_RE.test(trimmed)) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const type = (obj.type as StreamEventType) || "message";
    return {
      type,
      timestamp: (obj.timestamp as number) || timestamp,
      id: (obj.id as string) || nanoid(10),
      parentId: (obj.parentId as string | null) ?? null,
      title: (obj.title as string) || typeToTitle(type, String(obj.content ?? "")),
      content: String(obj.content ?? obj.message ?? obj.text ?? ""),
      toolName: obj.toolName as string | undefined,
      status: obj.status as StreamEvent["status"],
      path: obj.path as string | undefined,
      oldPath: obj.oldPath as string | undefined,
      diffStatus: obj.diffStatus as StreamEvent["diffStatus"],
      oldContent: obj.oldContent as string | undefined,
      newContent: obj.newContent as string | undefined,
      language: obj.language as string | undefined,
      meta: obj.meta as Record<string, unknown> | undefined,
      links: obj.links as StreamEvent["links"],
      subagentId: obj.subagentId as string | undefined,
      durationMs: obj.durationMs as number | undefined,
      sessionId: obj.sessionId as string | undefined,
    };
  } catch {
    return null;
  }
}

export function parseTextLine(line: string, timestamp = Date.now()): StreamEvent {
  const trimmed = line.replace(/\r$/, "");
  const nd = parseNdjsonLine(trimmed, timestamp);
  if (nd) return nd;

  const type = detectType(trimmed);
  const toolMatch = trimmed.match(TOOL_CALL_RE) || trimmed.match(TOOL_RESULT_RE);
  const fileMatch = trimmed.match(FILE_CHANGE_RE);

  return {
    type,
    timestamp,
    id: nanoid(10),
    parentId: null,
    title: typeToTitle(type, trimmed),
    content: trimmed,
    toolName: toolMatch?.[1],
    path: fileMatch?.[1],
    status: type === "error" ? "error" : type === "tool_call" ? "running" : "success",
  };
}

export function parseBulkText(text: string): StreamEvent[] {
  const lines = text.split(/\r?\n/);
  const events: StreamEvent[] = [];
  let buffer: string[] = [];
  let bufferType: StreamEventType | null = null;
  let bufferStart = Date.now();
  let t = Date.now() - lines.length * 80;

  const flush = () => {
    if (buffer.length === 0 || !bufferType) return;
    const content = buffer.join("\n");
    events.push({
      type: bufferType,
      timestamp: bufferStart,
      id: nanoid(10),
      parentId: null,
      title: typeToTitle(bufferType, content),
      content,
      status: bufferType === "error" ? "error" : "success",
    });
    buffer = [];
    bufferType = null;
  };

  for (const line of lines) {
    t += 80;
    if (!line.trim()) {
      flush();
      continue;
    }

    const nd = parseNdjsonLine(line, t);
    if (nd) {
      flush();
      events.push(nd);
      continue;
    }

    const type = detectType(line);
    // Group consecutive thinking/message lines
    if (
      bufferType &&
      (type === bufferType || (bufferType === "thinking" && type === "message"))
    ) {
      buffer.push(line);
    } else {
      flush();
      bufferType = type;
      bufferStart = t;
      buffer = [line];
    }
  }
  flush();
  return events;
}

export function streamEventToNodeType(type: StreamEventType): TraceNodeType {
  switch (type) {
    case "thinking":
      return "thinking";
    case "reasoning":
      return "reasoning";
    case "tool_call":
      return "tool_call";
    case "tool_result":
      return "tool_result";
    case "plan":
    case "plan_update":
      return "plan";
    case "subagent_start":
    case "subagent_end":
      return "subagent";
    case "file_change":
    case "diff":
      return "file_change";
    case "error":
      return "error";
    case "goal":
      return "goal";
    case "system":
    case "session_start":
    case "session_end":
      return "system";
    default:
      return "message";
  }
}

/** Try to extract file paths mentioned in free text */
export function extractPaths(text: string): string[] {
  const re = /(?:^|[\s`"'(])((?:src|app|lib|components|pages|hooks|api|public|tests?|scripts?)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/gm;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}
