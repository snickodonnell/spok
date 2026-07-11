/**
 * Session-scoped prompt attachments for Spok.
 *
 * Files live under ~/.spok/sessions/<id>/attachments/ and are cleaned up with
 * the session directory. Never expose absolute storage paths to the UI.
 *
 * Grok CLI integration uses ACP content blocks via --prompt-file (JSON array):
 *   images → { type: "image", mimeType, data: base64 }
 *   text docs → embedded { type: "resource", resource: { text } }
 *   PDFs / binary → { type: "resource_link", uri: file://... } so the CLI can read them
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { getSessionsRoot } from "@/lib/spok-paths";
import { canonicalizePath, isPathInsideRoot } from "@/lib/security/paths";
import { replacePromptWithFile } from "@/lib/grok-commands";

export const ATTACHMENT_LIMITS = {
  /** Max files per turn */
  maxFiles: 8,
  /** Max single file size (bytes) */
  maxFileBytes: 12 * 1024 * 1024,
  /** Max total bytes across files in one turn */
  maxTotalBytes: 24 * 1024 * 1024,
  /** Inline image base64 into vision blocks up to this size */
  maxInlineImageBytes: 4 * 1024 * 1024,
  /** Inline text content up to this size */
  maxInlineTextBytes: 512 * 1024,
} as const;

export type AttachmentKind = "image" | "document" | "text" | "binary";

/** Public metadata returned to the client (no absolute paths). */
export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  createdAt: number;
}

/** ACP content block shapes accepted by `grok --prompt-json` / `--prompt-file`. */
export type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
    }
  | {
      type: "resource_link";
      uri: string;
      name?: string;
      mimeType?: string;
      description?: string;
    };

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".heic",
  ".heif",
]);

const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".sql",
  ".graphql",
  ".vue",
  ".svelte",
  ".log",
  ".r",
  ".swift",
  ".dart",
  ".lua",
  ".pl",
  ".scala",
  ".clj",
]);

const DOC_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".epub",
]);

function assertSessionId(id: string): string {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    throw new Error(`Invalid session id: ${id}`);
  }
  return id;
}

export function sessionDir(sessionId: string): string {
  return path.join(getSessionsRoot(), assertSessionId(sessionId));
}

export function attachmentsRoot(sessionId: string): string {
  return path.join(sessionDir(sessionId), "attachments");
}

function attachmentDir(sessionId: string, attachmentId: string): string {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(attachmentId)) {
    throw new Error(`Invalid attachment id: ${attachmentId}`);
  }
  return path.join(attachmentsRoot(sessionId), attachmentId);
}

function metaPath(sessionId: string, attachmentId: string): string {
  return path.join(attachmentDir(sessionId, attachmentId), "meta.json");
}

function dataPath(sessionId: string, attachmentId: string, name: string): string {
  return path.join(attachmentDir(sessionId, attachmentId), sanitizeFilename(name));
}

/** Strip path components and dangerous characters from user-facing names. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f<>:"|?*\\/]/g, "_");
  const trimmed = base.trim() || "file";
  return trimmed.slice(0, 180);
}

export function detectMimeType(filename: string, declared?: string | null): string {
  const declaredTrim = declared?.trim().toLowerCase();
  if (
    declaredTrim &&
    declaredTrim !== "application/octet-stream" &&
    declaredTrim.includes("/")
  ) {
    return declaredTrim;
  }
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/tsx",
    ".jsx": "text/jsx",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".toml": "application/toml",
    ".py": "text/x-python",
    ".rs": "text/x-rust",
    ".go": "text/x-go",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

export function classifyAttachment(
  filename: string,
  mimeType: string
): AttachmentKind {
  const mime = mimeType.toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime === "application/pdf" || DOC_EXT.has(ext)) return "document";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    TEXT_EXT.has(ext)
  ) {
    return "text";
  }
  return "binary";
}

function ensureSessionAttachments(sessionId: string): string {
  const root = attachmentsRoot(sessionId);
  // Allow attachments even if session was only in-memory: create session dir
  const sdir = sessionDir(sessionId);
  if (!existsSync(sdir)) {
    mkdirSync(sdir, { recursive: true });
  }
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  return root;
}

function newAttachmentId(): string {
  return randomBytes(8).toString("hex");
}

export function saveAttachmentBytes(
  sessionId: string,
  opts: {
    name: string;
    mimeType?: string | null;
    data: Buffer;
  }
): AttachmentMeta {
  assertSessionId(sessionId);
  const name = sanitizeFilename(opts.name);
  const size = opts.data.byteLength;
  if (size <= 0) {
    throw new Error("Empty file");
  }
  if (size > ATTACHMENT_LIMITS.maxFileBytes) {
    throw new Error(
      `File too large (max ${Math.round(ATTACHMENT_LIMITS.maxFileBytes / (1024 * 1024))}MB)`
    );
  }

  const mimeType = detectMimeType(name, opts.mimeType);
  const kind = classifyAttachment(name, mimeType);
  const id = newAttachmentId();
  ensureSessionAttachments(sessionId);
  const dir = attachmentDir(sessionId, id);
  mkdirSync(dir, { recursive: true });

  const filePath = dataPath(sessionId, id, name);
  writeFileSync(filePath, opts.data);

  const meta: AttachmentMeta = {
    id,
    name,
    mimeType,
    kind,
    size,
    createdAt: Date.now(),
  };
  writeFileSync(metaPath(sessionId, id), JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

export function readAttachmentMeta(
  sessionId: string,
  attachmentId: string
): AttachmentMeta | null {
  try {
    const p = metaPath(sessionId, attachmentId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as AttachmentMeta;
  } catch {
    return null;
  }
}

export function resolveAttachmentFilePath(
  sessionId: string,
  meta: AttachmentMeta
): string {
  const file = dataPath(sessionId, meta.id, meta.name);
  const root = attachmentsRoot(sessionId);
  if (!isPathInsideRoot(file, root)) {
    throw new Error("Attachment path escapes session storage");
  }
  if (!existsSync(file)) {
    throw new Error(`Attachment file missing: ${meta.name}`);
  }
  return canonicalizePath(file);
}

export function deleteAttachment(
  sessionId: string,
  attachmentId: string
): boolean {
  assertSessionId(sessionId);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(attachmentId)) return false;
  const dir = attachmentDir(sessionId, attachmentId);
  const root = attachmentsRoot(sessionId);
  if (!isPathInsideRoot(dir, root)) return false;
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function listAttachmentMetas(sessionId: string): AttachmentMeta[] {
  const root = attachmentsRoot(sessionId);
  if (!existsSync(root)) return [];
  const out: AttachmentMeta[] = [];
  for (const name of readdirSync(root)) {
    const meta = readAttachmentMeta(sessionId, name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

function fileUri(absPath: string): string {
  // Windows: file:///C:/path
  const resolved = path.resolve(absPath);
  if (process.platform === "win32") {
    const normalized = resolved.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(normalized)) {
      return `file:///${normalized}`;
    }
    return `file://${normalized}`;
  }
  return `file://${resolved}`;
}

function isLikelyUtf8Text(buf: Buffer): boolean {
  // Reject if too many nulls or high ratio of non-text control chars
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) bad++;
  }
  return bad / sample.length < 0.05;
}

/**
 * Build ACP content blocks for a user prompt + stored attachments.
 * Absolute paths appear only inside blocks for the CLI — never return them to UI.
 */
export function buildPromptContentBlocks(
  sessionId: string,
  prompt: string,
  attachmentIds: string[]
): { blocks: AcpContentBlock[]; metas: AttachmentMeta[]; warnings: string[] } {
  const blocks: AcpContentBlock[] = [];
  const metas: AttachmentMeta[] = [];
  const warnings: string[] = [];

  if (attachmentIds.length > ATTACHMENT_LIMITS.maxFiles) {
    throw new Error(
      `Too many attachments (max ${ATTACHMENT_LIMITS.maxFiles})`
    );
  }

  let total = 0;
  for (const id of attachmentIds) {
    const meta = readAttachmentMeta(sessionId, id);
    if (!meta) {
      warnings.push(`Missing attachment ${id}`);
      continue;
    }
    total += meta.size;
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) {
      throw new Error(
        `Attachments exceed total size limit (${Math.round(ATTACHMENT_LIMITS.maxTotalBytes / (1024 * 1024))}MB)`
      );
    }
    metas.push(meta);
    const filePath = resolveAttachmentFilePath(sessionId, meta);
    const buf = readFileSync(filePath);

    if (meta.kind === "image") {
      if (buf.byteLength <= ATTACHMENT_LIMITS.maxInlineImageBytes) {
        blocks.push({
          type: "image",
          mimeType: meta.mimeType || "image/png",
          data: buf.toString("base64"),
        });
      } else {
        // Large images: link by path so Grok can open with vision tools
        blocks.push({
          type: "resource_link",
          uri: fileUri(filePath),
          name: meta.name,
          mimeType: meta.mimeType,
          description: `User-attached image (large; open with vision tools)`,
        });
        warnings.push(
          `${meta.name} is large — linked for tool access instead of inline vision`
        );
      }
      continue;
    }

    if (meta.kind === "text") {
      if (
        buf.byteLength <= ATTACHMENT_LIMITS.maxInlineTextBytes &&
        isLikelyUtf8Text(buf)
      ) {
        const text = buf.toString("utf8");
        blocks.push({
          type: "resource",
          resource: {
            uri: `attachment://${meta.id}/${meta.name}`,
            mimeType: meta.mimeType || "text/plain",
            text,
          },
        });
      } else {
        blocks.push({
          type: "resource_link",
          uri: fileUri(filePath),
          name: meta.name,
          mimeType: meta.mimeType,
          description: "User-attached text document",
        });
      }
      continue;
    }

    // PDFs, office docs, binary: resource_link so the agent can read_file them
    blocks.push({
      type: "resource_link",
      uri: fileUri(filePath),
      name: meta.name,
      mimeType: meta.mimeType,
      description:
        meta.kind === "document"
          ? "User-attached document — read and analyze its content"
          : "User-attached file",
    });
  }

  const names = metas.map((m) => m.name);
  const preamble =
    names.length > 0
      ? `The user attached ${names.length} file(s) for this turn: ${names.join(", ")}. Use them as context when answering.\n\n`
      : "";

  blocks.push({
    type: "text",
    text: `${preamble}${prompt}`,
  });

  return { blocks, metas, warnings };
}

/**
 * Write turn prompt JSON for `grok --prompt-file` and return the absolute path.
 */
export function writeTurnPromptFile(
  sessionId: string,
  turnId: string,
  blocks: AcpContentBlock[]
): string {
  assertSessionId(sessionId);
  const safeTurn = turnId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "turn";
  const dir = path.join(attachmentsRoot(sessionId), "_prompts");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeTurn}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(blocks), "utf8");
  // Validate containment
  if (!isPathInsideRoot(file, attachmentsRoot(sessionId))) {
    throw new Error("Prompt file path escapes session storage");
  }
  return canonicalizePath(file);
}

/** Prepare full CLI args for a prompt turn that includes attachments. */
export function prepareAttachedRun(opts: {
  sessionId: string;
  turnId: string;
  prompt: string;
  attachmentIds: string[];
  baseArgs: string[];
}): {
  args: string[];
  metas: AttachmentMeta[];
  warnings: string[];
  promptFile: string;
} {
  const { blocks, metas, warnings } = buildPromptContentBlocks(
    opts.sessionId,
    opts.prompt,
    opts.attachmentIds
  );
  const promptFile = writeTurnPromptFile(
    opts.sessionId,
    opts.turnId,
    blocks
  );
  const args = replacePromptWithFile(opts.baseArgs, promptFile);
  return { args, metas, warnings, promptFile };
}

/** Best-effort size check for an existing attachment id. */
export function attachmentExists(sessionId: string, id: string): boolean {
  return readAttachmentMeta(sessionId, id) != null;
}

export function getAttachmentDiskUsage(sessionId: string): number {
  const root = attachmentsRoot(sessionId);
  if (!existsSync(root)) return 0;
  let total = 0;
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        try {
          total += statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(root);
  return total;
}
