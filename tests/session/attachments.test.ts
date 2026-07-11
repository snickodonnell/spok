import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ATTACHMENT_LIMITS,
  buildPromptContentBlocks,
  classifyAttachment,
  deleteAttachment,
  detectMimeType,
  prepareAttachedRun,
  sanitizeFilename,
  saveAttachmentBytes,
} from "../../src/lib/attachments";
import {
  defaultGrokFlags,
  replacePromptWithFile,
  resolveRun,
} from "../../src/lib/grok-commands";

describe("attachment classification", () => {
  it("classifies images, text, documents, binary", () => {
    assert.equal(classifyAttachment("shot.png", "image/png"), "image");
    assert.equal(classifyAttachment("notes.md", "text/markdown"), "text");
    assert.equal(classifyAttachment("report.pdf", "application/pdf"), "document");
    assert.equal(
      classifyAttachment("blob.bin", "application/octet-stream"),
      "binary"
    );
  });

  it("detects mime from extension when declared is generic", () => {
    assert.equal(detectMimeType("x.png", "application/octet-stream"), "image/png");
    assert.equal(detectMimeType("x.pdf", ""), "application/pdf");
    assert.equal(detectMimeType("x.ts", null), "text/typescript");
  });

  it("sanitizes filenames", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFilename('bad:name*.txt'), "bad_name_.txt");
  });
});

describe("attachment storage + content blocks", () => {
  let dir: string;
  let prevSessions: string | undefined;

  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "spok-attach-"));
    prevSessions = process.env.SPOK_SESSIONS_DIR;
    process.env.SPOK_SESSIONS_DIR = dir;
  });

  after(() => {
    if (prevSessions === undefined) delete process.env.SPOK_SESSIONS_DIR;
    else process.env.SPOK_SESSIONS_DIR = prevSessions;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and deletes session-scoped attachments", () => {
    const sessionId = "testSession01";
    const meta = saveAttachmentBytes(sessionId, {
      name: "hello.txt",
      mimeType: "text/plain",
      data: Buffer.from("hello world", "utf8"),
    });
    assert.equal(meta.name, "hello.txt");
    assert.equal(meta.kind, "text");
    assert.ok(meta.id.length >= 6);

    const { blocks, metas } = buildPromptContentBlocks(
      sessionId,
      "What does the file say?",
      [meta.id]
    );
    assert.equal(metas.length, 1);
    assert.ok(blocks.some((b) => b.type === "resource"));
    assert.ok(blocks.some((b) => b.type === "text"));
    const textBlock = blocks.find((b) => b.type === "text");
    assert.ok(textBlock && textBlock.type === "text");
    assert.match(textBlock.text, /What does the file say/);
    assert.match(textBlock.text, /hello\.txt/);

    assert.equal(deleteAttachment(sessionId, meta.id), true);
    assert.equal(deleteAttachment(sessionId, meta.id), false);
  });

  it("inlines images as ACP image blocks with base64", () => {
    const sessionId = "testSession02";
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const meta = saveAttachmentBytes(sessionId, {
      name: "pixel.png",
      mimeType: "image/png",
      data: png,
    });
    const { blocks } = buildPromptContentBlocks(sessionId, "describe", [
      meta.id,
    ]);
    const img = blocks.find((b) => b.type === "image");
    assert.ok(img && img.type === "image");
    assert.equal(img.mimeType, "image/png");
    assert.ok(img.data.length > 10);
  });

  it("links PDFs via resource_link", () => {
    const sessionId = "testSession03";
    const meta = saveAttachmentBytes(sessionId, {
      name: "doc.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.1 minimal"),
    });
    const { blocks } = buildPromptContentBlocks(sessionId, "summarize", [
      meta.id,
    ]);
    const link = blocks.find((b) => b.type === "resource_link");
    assert.ok(link && link.type === "resource_link");
    assert.equal(link.name, "doc.pdf");
    assert.match(link.uri, /^file:/);
    // UI-facing metas never include absolute path fields
    assert.equal("path" in meta, false);
  });

  it("prepareAttachedRun swaps -p for --prompt-file", () => {
    const sessionId = "testSession04";
    const meta = saveAttachmentBytes(sessionId, {
      name: "notes.md",
      mimeType: "text/markdown",
      data: Buffer.from("# Title\nbody", "utf8"),
    });
    const base = resolveRun("Summarize the notes", defaultGrokFlags());
    assert.equal(base.type, "prompt");
    if (base.type !== "prompt") return;

    const prepared = prepareAttachedRun({
      sessionId,
      turnId: "turn1",
      prompt: "Summarize the notes",
      attachmentIds: [meta.id],
      baseArgs: base.args,
    });

    assert.ok(prepared.args.includes("--prompt-file"));
    assert.ok(!prepared.args.includes("-p"));
    const pf = prepared.args[prepared.args.indexOf("--prompt-file") + 1];
    assert.ok(existsSync(pf));
    const json = JSON.parse(readFileSync(pf, "utf8")) as unknown[];
    assert.ok(Array.isArray(json));
    assert.ok(json.length >= 2);
  });

  it("rejects oversized files", () => {
    const sessionId = "testSession05";
    const big = Buffer.alloc(ATTACHMENT_LIMITS.maxFileBytes + 1, 1);
    assert.throws(
      () =>
        saveAttachmentBytes(sessionId, {
          name: "big.bin",
          data: big,
        }),
      /too large/i
    );
  });
});

describe("replacePromptWithFile", () => {
  it("replaces -p value with --prompt-file", () => {
    const args = ["--output-format", "streaming-json", "-p", "hello world"];
    const next = replacePromptWithFile(args, "C:\\tmp\\prompt.json");
    assert.deepEqual(next, [
      "--output-format",
      "streaming-json",
      "--prompt-file",
      "C:\\tmp\\prompt.json",
    ]);
  });

  it("preserves multi-word prompts as single argv when building resolveRun", () => {
    const run = resolveRun("Audit this repo carefully", defaultGrokFlags());
    assert.equal(run.type, "prompt");
    if (run.type === "prompt") {
      const pIdx = run.args.indexOf("-p");
      assert.equal(run.args[pIdx + 1], "Audit this repo carefully");
    }
  });
});
