import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  renameSync,
} from "fs";
import path from "path";
import type { Session, SessionMetaRecord, StreamEvent } from "./types";
import { redactSecrets } from "./security/secrets";
import {
  ensureSessionsRoot,
  getSessionsRoot as sessionsRootPath,
} from "@/lib/spok-paths";

export const SESSION_LOG_FORMAT_VERSION = 1 as const;
export type { SessionMetaRecord };

export type RawLogEnvelope = {
  seq: number;
  timestamp: number;
  kind: "stdout" | "stderr" | "line" | "client" | "system";
  data: string;
};

export type NormalizedLogEnvelope = {
  seq: number;
  timestamp: number;
  event: StreamEvent;
};

export function getSessionsRoot(): string {
  return sessionsRootPath();
}

function ensureRoot(): string {
  return ensureSessionsRoot();
}

function sessionDir(id: string): string {
  // Prevent path traversal — only allow safe session ids
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
    throw new Error(`Invalid session id: ${id}`);
  }
  return path.join(ensureRoot(), id);
}

function metaPath(id: string): string {
  return path.join(sessionDir(id), "meta.json");
}

function eventsPath(id: string): string {
  return path.join(sessionDir(id), "events.ndjson");
}

function rawPath(id: string): string {
  return path.join(sessionDir(id), "raw.ndjson");
}

function snapshotPath(id: string): string {
  return path.join(sessionDir(id), "snapshot.json");
}

function atomicWriteJson(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    renameSync(tmp, file);
  } catch {
    // Windows may fail rename over existing file — fallback
    writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function countNdjsonLines(file: string): number {
  if (!existsSync(file)) return 0;
  const text = readFileSync(file, "utf8");
  if (!text.trim()) return 0;
  return text.split(/\r?\n/).filter((l) => l.trim()).length;
}

export function createSessionOnDisk(
  meta: Omit<SessionMetaRecord, "formatVersion" | "eventCount" | "rawCount"> & {
    eventCount?: number;
    rawCount?: number;
  }
): SessionMetaRecord {
  const dir = sessionDir(meta.id);
  mkdirSync(dir, { recursive: true });
  const existing = readSessionMeta(meta.id);
  if (existing) {
    // Idempotent re-register (e.g. app reopen of same id)
    const merged: SessionMetaRecord = {
      ...existing,
      name: meta.name || existing.name,
      status: meta.status || existing.status,
      cwd: meta.cwd || existing.cwd,
      command: meta.command || existing.command,
      source: meta.source || existing.source,
      grokFlags: meta.grokFlags ?? existing.grokFlags,
      updatedAt: Date.now(),
      formatVersion: SESSION_LOG_FORMAT_VERSION,
    };
    atomicWriteJson(metaPath(meta.id), merged);
    return merged;
  }
  const record: SessionMetaRecord = {
    ...meta,
    formatVersion: SESSION_LOG_FORMAT_VERSION,
    eventCount: meta.eventCount ?? 0,
    rawCount: meta.rawCount ?? 0,
  };
  atomicWriteJson(metaPath(meta.id), record);
  // Touch empty logs
  if (!existsSync(eventsPath(meta.id))) writeFileSync(eventsPath(meta.id), "", "utf8");
  if (!existsSync(rawPath(meta.id))) writeFileSync(rawPath(meta.id), "", "utf8");
  return record;
}

export function readSessionMeta(id: string): SessionMetaRecord | null {
  return readJsonFile<SessionMetaRecord>(metaPath(id));
}

export function updateSessionMeta(
  id: string,
  patch: Partial<SessionMetaRecord>
): SessionMetaRecord | null {
  const prev = readSessionMeta(id);
  if (!prev) return null;
  const next: SessionMetaRecord = {
    ...prev,
    ...patch,
    id: prev.id,
    formatVersion: SESSION_LOG_FORMAT_VERSION,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  atomicWriteJson(metaPath(id), next);
  return next;
}

export function listSessionMetas(): SessionMetaRecord[] {
  const root = ensureRoot();
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const metas: SessionMetaRecord[] = [];
  for (const id of ids) {
    try {
      const m = readSessionMeta(id);
      if (m) {
        // Refresh counts from disk if meta is stale
        const eventCount = countNdjsonLines(eventsPath(id));
        const rawCount = countNdjsonLines(rawPath(id));
        if (m.eventCount !== eventCount || m.rawCount !== rawCount) {
          const updated = updateSessionMeta(id, { eventCount, rawCount });
          if (updated) metas.push(updated);
          else metas.push(m);
        } else {
          metas.push(m);
        }
      }
    } catch {
      /* skip corrupt */
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function appendNormalizedEvents(
  id: string,
  events: StreamEvent[]
): { appended: number; eventCount: number } {
  if (!events.length) {
    const m = readSessionMeta(id);
    return { appended: 0, eventCount: m?.eventCount ?? 0 };
  }
  if (!existsSync(sessionDir(id))) {
    throw new Error(`Session not found: ${id}`);
  }

  const startSeq = countNdjsonLines(eventsPath(id));
  const lines: string[] = [];
  let seq = startSeq;
  for (const event of events) {
    seq += 1;
    const redacted: StreamEvent = {
      ...event,
      content:
        event.content != null ? redactSecrets(event.content).text : event.content,
      summary:
        event.summary != null ? redactSecrets(event.summary).text : event.summary,
      oldContent:
        event.oldContent != null
          ? redactSecrets(event.oldContent).text
          : event.oldContent,
      newContent:
        event.newContent != null
          ? redactSecrets(event.newContent).text
          : event.newContent,
    };
    const envelope: NormalizedLogEnvelope = {
      seq,
      timestamp: redacted.timestamp || Date.now(),
      event: {
        ...redacted,
        rawEventId: redacted.rawEventId ?? `evt-${seq}`,
      },
    };
    lines.push(JSON.stringify(envelope));
  }
  appendFileSync(eventsPath(id), lines.join("\n") + "\n", "utf8");
  const eventCount = startSeq + lines.length;
  updateSessionMeta(id, { eventCount, updatedAt: Date.now() });
  return { appended: lines.length, eventCount };
}

export function appendRawEnvelopes(
  id: string,
  envelopes: Array<Omit<RawLogEnvelope, "seq"> & { seq?: number }>
): { appended: number; rawCount: number } {
  if (!envelopes.length) {
    const m = readSessionMeta(id);
    return { appended: 0, rawCount: m?.rawCount ?? 0 };
  }
  if (!existsSync(sessionDir(id))) {
    throw new Error(`Session not found: ${id}`);
  }

  const startSeq = countNdjsonLines(rawPath(id));
  const lines: string[] = [];
  let seq = startSeq;
  for (const env of envelopes) {
    seq += 1;
    const data = redactSecrets(env.data).text;
    const envelope: RawLogEnvelope = {
      seq,
      timestamp: env.timestamp || Date.now(),
      kind: env.kind,
      data,
    };
    lines.push(JSON.stringify(envelope));
  }
  appendFileSync(rawPath(id), lines.join("\n") + "\n", "utf8");
  const rawCount = startSeq + lines.length;
  updateSessionMeta(id, { rawCount, updatedAt: Date.now() });
  return { appended: lines.length, rawCount };
}

export function readNormalizedEvents(id: string): StreamEvent[] {
  const file = eventsPath(id);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const events: StreamEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const env = JSON.parse(line) as NormalizedLogEnvelope | StreamEvent;
      if ("event" in env && env.event) {
        events.push(env.event);
      } else if ("type" in env) {
        events.push(env as StreamEvent);
      }
    } catch {
      /* skip bad line */
    }
  }
  return events;
}

export function readRawEnvelopes(id: string): RawLogEnvelope[] {
  const file = rawPath(id);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const out: RawLogEnvelope[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RawLogEnvelope);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function writeSnapshot(id: string, session: Session): void {
  if (!existsSync(sessionDir(id))) {
    throw new Error(`Session not found: ${id}`);
  }
  // Redact snapshot lightly (full redaction happens on export)
  const scrubbed: Session = {
    ...session,
    rawLog: session.rawLog.map((l) => redactSecrets(l).text),
  };
  atomicWriteJson(snapshotPath(id), scrubbed);
  updateSessionMeta(id, {
    name: session.name,
    status:
      session.status === "running" || session.status === "starting"
        ? "ready"
        : session.status,
    updatedAt: Date.now(),
    cwd: session.config.cwd,
    command: session.config.command,
    source: session.source,
    grokFlags: session.grokFlags,
    error: session.error,
  });
}

export function readSnapshot(id: string): Session | null {
  return readJsonFile<Session>(snapshotPath(id));
}

export function deleteSessionOnDisk(id: string): boolean {
  const dir = sessionDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function sessionExistsOnDisk(id: string): boolean {
  try {
    return existsSync(metaPath(id));
  } catch {
    return false;
  }
}
