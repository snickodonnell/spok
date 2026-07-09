/**
 * Thinking-panel helpers: classification, coalescing, permanent segment assembly.
 * Progress thoughts stay append-only; technical CLI noise stays out.
 */

/** Drop system-prompt dumps from thinking. */
export function isSystemPromptNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^SYSTEM\s*PROMPT\b/i.test(t)) return true;
  if (/^\[SYSTEM(?:\s+PROMPT)?\]/i.test(t)) return true;
  if (/^#{1,3}\s*System\s*Prompt\b/i.test(t)) return true;
  if (/^<system>[\s\S]*<\/system>\s*$/i.test(t)) return true;
  if (/^\{\s*type\s*,\s*data\s*\}$/i.test(t)) return true;
  if (/^\{\s*[\w]+(?:\s*,\s*[\w]+){0,4}\s*\}$/.test(t) && t.length < 48) {
    return true;
  }
  return false;
}

/**
 * Technical CLI / Git / shell noise — never in the Thinking panel.
 */
export function isTechnicalCliNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  if (/\d+\s+files?\s+changed/i.test(t)) return true;
  if (/\d+\s+insertions?\(\+\)|\d+\s+deletions?\(-\)/i.test(t)) return true;
  if (
    /[+]?\s*\d+[\s,]*[−\-–—]\s*\d+/.test(t) &&
    t.length < 80 &&
    !/[a-z]{4,}/i.test(t.replace(/\d+/g, ""))
  )
    return true;
  if (/^\s*[+]{3,}|^\s*[-]{3,}/.test(t)) return true;
  if (
    /^diff --git\s/i.test(t) ||
    /^@@\s+-\d+/.test(t) ||
    /^index\s+[0-9a-f]+\.\./i.test(t)
  )
    return true;

  if (
    /^(?:commit|Create mode|delete mode|rename|rewrite|Author:|Date:)\b/i.test(
      t
    )
  )
    return true;
  if (/^\[[\w./-]+(?:\s+[0-9a-f]{7,40})?\]/i.test(t)) return true;
  if (
    /\b(?:git|gh)\s+(?:commit|push|pull|add|status|diff|checkout|branch|log|merge|rebase|fetch|remote|tag)\b/i.test(
      t
    )
  )
    return true;
  if (/\bTo\s+https?:\/\/\S+\.git\b/i.test(t)) return true;
  if (/^\s*\*\s*\[new (?:branch|tag)\]/i.test(t)) return true;
  if (/branch\s+['`].+['`]\s+set up to track/i.test(t)) return true;
  if (/Everything up-to-date/i.test(t)) return true;
  if (/^\s*(?:Writing|Counting|Compressing|Receiving)\s+objects:/i.test(t))
    return true;
  if (/^\s*Total\s+\d+\s*\(delta/i.test(t)) return true;
  if (/fast-forward|FF\s+only|non-fast-forward/i.test(t) && t.length < 120)
    return true;
  if (/^\s*\$\s*(?:git|npm|pnpm|yarn|gh|node|tsx)\b/i.test(t)) return true;

  if (/^[0-9a-f]{7,40}$/i.test(t)) return true;
  if (/^[0-9a-f]{7,40}\b/i.test(t) && t.length < 64 && !/[.!?]/.test(t))
    return true;

  // Path-only (require separator — bare "package.json" in prose is kept)
  if (
    /^(?:[A-Za-z]:)?[/\\][\w./\\-]+\.\w{1,8}$/.test(t) ||
    /^[\w.-]+(?:\/|\\)[\w./\\-]+\.\w{1,8}$/.test(t)
  ) {
    return true;
  }
  if (
    (t.startsWith("{") || t.startsWith("[")) &&
    /"(?:path|file_path|target_file|command|args|old_string|new_string)"/.test(
      t
    )
  ) {
    return true;
  }

  if (
    /^(?:Tool|Result|list_dir|read_file|search_replace|write_file)\b/i.test(
      t
    ) &&
    t.length < 160
  )
    return true;
  if (/^(?:Reading|Writing|Editing|Listing|Running)\s+[\w./\\-]+$/i.test(t))
    return true;

  const hashCount = (t.match(/\b[0-9a-f]{7,40}\b/gi) || []).length;
  const wordCount = (t.match(/[A-Za-z]{3,}/g) || []).length;
  if (hashCount >= 2 && wordCount < hashCount * 4) return true;

  return false;
}

export function isNonThoughtContent(text: string): boolean {
  return isSystemPromptNoise(text) || isTechnicalCliNoise(text);
}

/**
 * User-visible progress / status prose the agent emits while working
 * (permanent in Thinking panel — not cleared when the next step starts).
 * Intentionally narrow so long final summaries are not mislabeled as progress.
 */
export function isProgressStatusMessage(text: string): boolean {
  const t = text.trim();
  if (!t || isNonThoughtContent(t)) return false;
  if (t.length < 12 || t.length > 600) return false;
  if (/```/.test(t)) return false;

  return /^(?:The user wants|I'll |I will |I need to |I should |I'm |I am |Reading |Looking |Checking |Inspecting |Exploring |Found |Running into |Ran into |Next[, ]|Let me |Starting |Continuing |Done with|Working on |Updating |Fixing |Adding |Removing |Implementing |Reviewing |Opening |Searching |Gathering |Analyzing |Planning )/i.test(
    t
  );
}

export function extractDisplayText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "";
    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(s) as unknown;
        const nested = extractDisplayText(parsed);
        if (nested) return nested;
      } catch {
        /* keep */
      }
    }
    return s;
  }
  if (Array.isArray(raw)) {
    return raw.map((x) => extractDisplayText(x)).filter(Boolean).join("");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of [
      "text",
      "thinking",
      "thought",
      "reasoning",
      "message",
      "content",
      "delta",
      "output",
      "value",
      "data",
    ]) {
      if (key in o) {
        const v = extractDisplayText(o[key]);
        if (v) return v;
      }
    }
  }
  return "";
}

export function cleanThoughtText(raw: unknown): string {
  let text = extractDisplayText(raw);
  if (!text) return "";
  if (isNonThoughtContent(text) && !text.includes("\n")) return "";

  text = text.replace(/^(?:Thinking|Reasoning|Thought)\s*[:\-—]\s*/i, "");
  text = text.replace(/^SYSTEM\s*PROMPT\s*[:\n]+/i, "");

  const kept = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      return !isNonThoughtContent(s);
    });

  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();

  text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || isNonThoughtContent(text)) return "";
  return text;
}

export function mergeStreamingText(prev: string, chunk: string): string {
  if (!chunk) return prev || "";
  if (!prev) return chunk;

  if (chunk.startsWith(prev)) return chunk;
  if (prev.endsWith(chunk) && chunk.length >= Math.min(8, prev.length))
    return prev;
  if (prev.startsWith(chunk) && chunk.length < prev.length) return prev;

  if (
    chunk.startsWith(" ") ||
    chunk.startsWith("\n") ||
    chunk.startsWith("\t") ||
    prev.endsWith(" ") ||
    prev.endsWith("\n") ||
    prev.endsWith("\t") ||
    prev.endsWith("-") ||
    prev.endsWith("/")
  ) {
    return prev + chunk;
  }

  const max = Math.min(prev.length, chunk.length, 80);
  const minOverlap = chunk.length <= 2 ? 2 : 3;
  for (let n = max; n >= minOverlap; n--) {
    if (chunk.startsWith(prev.slice(-n))) {
      return prev + chunk.slice(n);
    }
  }

  if (/[\p{L}\p{N}]$/u.test(prev) && /^[\p{L}\p{N}]/u.test(chunk)) {
    return `${prev} ${chunk}`;
  }

  return prev + chunk;
}

export function preferFullerText(
  incoming: string | undefined | null,
  existing: string | undefined | null
): string {
  const a = incoming ?? "";
  const b = existing ?? "";
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (a.startsWith(b)) return a;
  if (b.startsWith(a)) return b;
  return a.length >= b.length ? a : b;
}

/** True when chunk continues the same streaming body (not a replacement status). */
export function isStreamingContinuation(
  prev: string,
  chunk: string
): boolean {
  if (!prev || !chunk) return true;
  // Cumulative snapshot
  if (chunk.startsWith(prev)) return true;
  if (prev.startsWith(chunk) && chunk.length < prev.length) return true;
  // Token deltas usually arrive with leading whitespace
  if (
    chunk.startsWith(" ") ||
    chunk.startsWith("\n") ||
    chunk.startsWith("\t")
  ) {
    return true;
  }
  // Very short bare tokens (stream fragments), not full status sentences
  if (chunk.length <= 24 && !/[.!?]$/.test(chunk.trim())) return true;
  // Meaningful boundary overlap
  const max = Math.min(prev.length, chunk.length, 40);
  for (let n = max; n >= 3; n--) {
    if (chunk.startsWith(prev.slice(-n))) return true;
  }
  return false;
}

export function formatThoughtProse(text: string): string {
  let t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n[ \t]+/g, "\n");
  t = t.replace(/[ \t]{2,}/g, " ");

  if (!t.includes("\n") && /[.!?]\s+[A-Z]/.test(t)) {
    t = t.replace(/([.!?])\s+(?=[A-Z“"'(\[])/g, "$1\n\n");
  }

  if (!/\n\n/.test(t) && t.length > 100) {
    t = t.replace(
      /\s+(?=(?:First|Next|Then|Also|However|Finally|Overall|So|Now|After that|Before that)\b)/g,
      "\n\n"
    );
  }

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export type ThoughtBlockKind = "progress" | "summary";

export type ThoughtBlock = {
  id: string;
  text: string;
  ts: number;
  kind: ThoughtBlockKind;
};

type SourceNode = {
  id: string;
  type: string;
  content?: string;
  summary?: string;
  timestamp: number;
  status?: string;
};

/**
 * Permanent append-only thinking/progress segments for the Thinking panel.
 *
 * - Each sealed thought / progress status stays forever (never cleared).
 * - Same-id streaming only keeps the fullest body for that segment.
 * - Technical CLI noise is excluded.
 * - A final non-progress agent message is shown last as the summary.
 */
export function collectThoughtBlocks(
  nodes: Record<string, SourceNode> | undefined,
  eventLog:
    | Array<{
        id?: string;
        type: string;
        content?: string;
        summary?: string;
        timestamp: number;
        status?: string;
      }>
    | undefined
): ThoughtBlock[] {
  const byId = new Map<
    string,
    { id: string; type: string; text: string; ts: number; status?: string }
  >();

  const consider = (n: {
    id: string;
    type: string;
    content?: string;
    summary?: string;
    timestamp: number;
    status?: string;
  }) => {
    const text = cleanThoughtText(n.content) || cleanThoughtText(n.summary);
    if (!text) return;

    const isThought = n.type === "thinking" || n.type === "reasoning";
    const isProgressMsg =
      n.type === "message" && isProgressStatusMessage(text);
    const isSummaryCandidate =
      n.type === "message" &&
      !isProgressStatusMessage(text) &&
      !isNonThoughtContent(text) &&
      text.length >= 40;

    if (!isThought && !isProgressMsg && !isSummaryCandidate) return;

    const prev = byId.get(n.id);
    if (!prev || text.length >= prev.text.length) {
      byId.set(n.id, {
        id: n.id,
        type: isThought
          ? "thinking"
          : isProgressMsg
            ? "progress"
            : "summary",
        text,
        ts: prev?.ts ?? n.timestamp,
        status: n.status,
      });
    }
  };

  if (nodes) {
    for (const n of Object.values(nodes)) consider(n);
  }

  // eventLog fills gaps only for ids we don't already have from nodes
  if (eventLog?.length) {
    for (const ev of eventLog) {
      const id = ev.id || `ev-${ev.timestamp}-${ev.type}`;
      if (nodes && ev.id && nodes[ev.id]) {
        // still allow longer content from event log
        consider({
          id,
          type: ev.type,
          content: ev.content,
          summary: ev.summary,
          timestamp: ev.timestamp,
          status: ev.status,
        });
        continue;
      }
      if (!nodes || !ev.id || !nodes[ev.id]) {
        consider({
          id,
          type: ev.type,
          content: ev.content,
          summary: ev.summary,
          timestamp: ev.timestamp,
          status: ev.status,
        });
      }
    }
  }

  const all = [...byId.values()].sort(
    (a, b) => a.ts - b.ts || a.id.localeCompare(b.id)
  );

  // Permanent progress/thought segments (not the final summary)
  const progress = all.filter(
    (x) => x.type === "thinking" || x.type === "progress"
  );
  const summaries = all.filter((x) => x.type === "summary");

  // Collapse true streaming fragments that are still separate ids but cumulative
  const sealedProgress = collapseStreamingDuplicates(progress);

  const blocks: ThoughtBlock[] = sealedProgress.map((p) => ({
    id: p.id,
    text: formatThoughtProse(p.text),
    ts: p.ts,
    kind: "progress" as const,
  }));

  // Final summary: last substantial agent message, if any
  const finalSummary = summaries.sort((a, b) => a.ts - b.ts).at(-1);
  if (finalSummary) {
    const text = formatThoughtProse(finalSummary.text);
    // Don't duplicate if identical to last progress line
    const lastProg = blocks[blocks.length - 1]?.text;
    if (text && text !== lastProg) {
      blocks.push({
        id: finalSummary.id,
        text,
        ts: finalSummary.ts,
        kind: "summary",
      });
    }
  }

  return blocks.filter((b) => b.text.length > 0);
}

/**
 * If several permanent ids are actually cumulative snapshots of one stream
 * (A, A+B, A+B+C), keep only the fullest. Distinct status lines stay separate.
 */
function collapseStreamingDuplicates(
  items: Array<{ id: string; type: string; text: string; ts: number }>
): Array<{ id: string; type: string; text: string; ts: number }> {
  if (items.length <= 1) return items;
  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const out: typeof sorted = [];

  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(item);
      continue;
    }
    // Cumulative extension of the previous permanent segment → replace in place
    if (
      item.text.startsWith(prev.text) ||
      prev.text.startsWith(item.text)
    ) {
      out[out.length - 1] = {
        ...item,
        text: preferFullerText(item.text, prev.text),
        ts: prev.ts, // keep first appearance time
        id: prev.id, // stable identity so UI doesn't thrash
      };
      continue;
    }
    // Short stream-token continuation of previous segment only
    if (
      item.text.length <= 24 &&
      isStreamingContinuation(prev.text, item.text)
    ) {
      out[out.length - 1] = {
        ...prev,
        text: formatThoughtProse(mergeStreamingText(prev.text, item.text)),
      };
      continue;
    }
    // Distinct permanent status / thought — keep forever
    out.push(item);
  }

  return out;
}
