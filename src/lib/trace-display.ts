import type { TraceNode, TraceNodeType } from "./types";

/** Nodes whose main value is prose the user should read. */
export function isProseTraceType(type: TraceNodeType): boolean {
  return (
    type === "thinking" ||
    type === "reasoning" ||
    type === "message" ||
    type === "goal" ||
    type === "plan" ||
    type === "plan_update" ||
    type === "decision"
  );
}

/** Compact action rows (tools, system) stay one-line. */
export function isActionTraceType(type: TraceNodeType): boolean {
  return (
    type === "tool_call" ||
    type === "tool_result" ||
    type === "file_change" ||
    type === "system" ||
    type === "session" ||
    type === "subagent" ||
    type === "error" ||
    type === "branch"
  );
}

function pathFromMeta(node: TraceNode): string | undefined {
  const meta = node.meta;
  if (!meta) return undefined;
  if (typeof meta.path === "string" && meta.path) return meta.path;
  const raw = meta.rawInput;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of [
      "file_path",
      "path",
      "target_file",
      "target_directory",
      "old_path",
      "new_path",
    ]) {
      if (typeof o[k] === "string" && o[k]) return String(o[k]);
    }
  }
  return undefined;
}

function shortPath(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length <= 3) return norm;
  return parts.slice(-3).join("/");
}

/**
 * Human-readable primary body for the tree + detail pane.
 * Prefer actual thought / message text over titles like "Thinking" or raw JSON.
 */
export function tracePrimaryText(node: TraceNode): string {
  const content = (node.content || "").trim();
  const summary = (node.summary || "").trim();

  if (isProseTraceType(node.type)) {
    // Prefer full content; fall back to summary then title
    if (content) return content;
    if (summary) return summary;
    return node.title || "";
  }

  if (node.type === "tool_call" || node.type === "tool_result") {
    const name = node.toolName || stripToolPrefix(node.title);
    const path = pathFromMeta(node) || extractPathFromText(content);
    if (path) {
      const verb =
        node.type === "tool_result"
          ? pastVerb(name)
          : presentVerb(name);
      return `${verb} ${shortPath(path)}`;
    }
    // Prefer a short title over dumping rawInput JSON as the headline
    if (name && name !== "tool") {
      return node.type === "tool_result" ? `${pastVerb(name)}` : presentVerb(name);
    }
    if (content && !looksLikeJsonBlob(content)) return content;
    return node.title || name || "Tool";
  }

  if (node.type === "file_change") {
    if (content && !content.startsWith("{")) return content;
    return node.title || "File change";
  }

  if (content && !looksLikeJsonBlob(content)) return content;
  if (summary) return summary;
  return node.title || node.type;
}

/** Small type/kind label shown above or beside the primary text. */
export function traceKindLabel(node: TraceNode): string {
  switch (node.type) {
    case "thinking":
    case "reasoning":
      return "Thinking";
    case "message":
      if (node.title === "Grok" || node.title === "Output") return "Reply";
      if (node.title === "You") return "You";
      return "Message";
    case "goal":
      return node.title === "You" ? "You" : "Goal";
    case "plan":
    case "plan_update":
      return "Plan";
    case "tool_call":
      return node.toolName || "Tool";
    case "tool_result":
      return node.toolName ? `${node.toolName} · result` : "Result";
    case "file_change":
      return "File";
    case "error":
      return "Error";
    case "system":
      return "System";
    case "subagent":
      return "Subagent";
    case "decision":
      return "Decision";
    default:
      return node.title || node.type;
  }
}

/**
 * Secondary line for action rows only (paths, brief args).
 * Not used as a substitute for thinking body.
 */
export function traceSecondaryText(node: TraceNode): string | null {
  if (isProseTraceType(node.type)) return null;

  if (node.type === "tool_call" || node.type === "tool_result") {
    const path = pathFromMeta(node) || extractPathFromText(node.content);
    // If primary already includes path, show a light status/detail
    if (path && tracePrimaryText(node).includes(shortPath(path))) {
      if (node.status === "error") return "failed";
      if (node.status === "running") return "running…";
      if (node.type === "tool_result" && node.content) {
        const c = node.content.trim();
        if (!looksLikeJsonBlob(c) && c.length < 160 && !c.includes(path)) {
          return firstLine(c);
        }
      }
      return null;
    }
    if (path) return shortPath(path);
    const c = (node.content || "").trim();
    if (c && !looksLikeJsonBlob(c)) return firstLine(c).slice(0, 120);
    return null;
  }

  const c = (node.content || node.summary || "").trim();
  if (!c || c === node.title) return null;
  if (looksLikeJsonBlob(c)) return null;
  return firstLine(c).slice(0, 140);
}

/** Full body for the detail reading pane. */
export function traceDetailBody(node: TraceNode): string {
  const content = (node.content || "").trim();
  if (content) return content;
  const summary = (node.summary || "").trim();
  if (summary) return summary;
  return "";
}

/** True when meta is only technical noise (prefer Log panel). */
export function hasTechnicalMeta(node: TraceNode): boolean {
  if (!node.meta || Object.keys(node.meta).length === 0) return false;
  return true;
}

function stripToolPrefix(title: string): string {
  return title.replace(/^(Tool|Result):\s*/i, "").trim();
}

function looksLikeJsonBlob(s: string): boolean {
  const t = s.trim();
  return (
    (t.startsWith("{") && t.includes("}")) ||
    (t.startsWith("[") && t.includes("]"))
  );
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim())?.trim() || s;
}

function extractPathFromText(text: string): string | undefined {
  if (!text) return undefined;
  // path keys in JSON-ish previews
  const m =
    text.match(
      /"(?:file_path|path|target_file|target_directory)"\s*:\s*"([^"]+)"/
    ) ||
    text.match(/`([^`]+\.[a-zA-Z0-9]+)`/) ||
    text.match(/(?:^|[\s])([A-Za-z0-9_./\\-]+\.[a-zA-Z]{1,8})\b/);
  return m?.[1];
}

function presentVerb(name: string): string {
  const n = name.toLowerCase();
  const map: Record<string, string> = {
    read_file: "Reading",
    read: "Reading",
    write: "Writing",
    search_replace: "Editing",
    edit: "Editing",
    list_dir: "Listing",
    list: "Listing",
    grep: "Searching",
    run: "Running",
    bash: "Running",
    shell: "Running",
    delete: "Deleting",
  };
  return map[n] || capitalize(name);
}

function pastVerb(name: string): string {
  const n = name.toLowerCase();
  const map: Record<string, string> = {
    read_file: "Read",
    read: "Read",
    write: "Wrote",
    search_replace: "Edited",
    edit: "Edited",
    list_dir: "Listed",
    list: "Listed",
    grep: "Searched",
    run: "Ran",
    bash: "Ran",
    shell: "Ran",
    delete: "Deleted",
  };
  return map[n] || capitalize(name);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
