"use client";

/**
 * Client helpers for prompt attachments (upload / remove / prepare).
 * Never surfaces absolute storage paths to callers.
 */

import { localFetch } from "./local-api-client";
import type { PromptAttachmentRef } from "./types";

export type UploadedAttachment = PromptAttachmentRef;

export async function uploadAttachments(
  sessionId: string,
  files: File[]
): Promise<{ attachments: UploadedAttachment[]; errors?: string[] }> {
  if (!files.length) return { attachments: [] };
  const form = new FormData();
  form.set("sessionId", sessionId);
  for (const f of files) {
    form.append("files", f, f.name);
  }
  const res = await localFetch("/api/session/attachments", {
    method: "POST",
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as {
    attachments?: UploadedAttachment[];
    errors?: string[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return {
    attachments: data.attachments ?? [],
    errors: data.errors,
  };
}

export async function removeAttachment(
  sessionId: string,
  attachmentId: string
): Promise<void> {
  const q = new URLSearchParams({
    sessionId,
    attachmentId,
  });
  const res = await localFetch(`/api/session/attachments?${q}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Delete failed (${res.status})`);
  }
}

export async function prepareAttachedPrompt(opts: {
  sessionId: string;
  turnId?: string;
  prompt: string;
  attachmentIds: string[];
  baseArgs: string[];
}): Promise<{
  args: string[];
  attachments: UploadedAttachment[];
  warnings: string[];
}> {
  const res = await localFetch("/api/session/attachments/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = (await res.json().catch(() => ({}))) as {
    args?: string[];
    attachments?: UploadedAttachment[];
    warnings?: string[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Prepare failed (${res.status})`);
  }
  return {
    args: data.args ?? opts.baseArgs,
    attachments: data.attachments ?? [],
    warnings: data.warnings ?? [],
  };
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentKindLabel(kind: string): string {
  switch (kind) {
    case "image":
      return "Image";
    case "document":
      return "Document";
    case "text":
      return "Text";
    default:
      return "File";
  }
}
