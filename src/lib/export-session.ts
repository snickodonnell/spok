import type { ExportPayload, ExportPayloadV2, Session, StreamEvent } from "./types";
import {
  isDeniedSecretPath,
  redactDeepStrings,
  redactSecrets,
} from "./security/secrets";
import { eventsFromSnapshotNodes } from "./session-replay";
import { migrateStreamEvents } from "./stream-event-schema";

/**
 * Build a redacted export payload suitable for sharing or download.
 * Phase 1: version 2 includes ordered events for faithful replay.
 */
export function buildExportPayload(session: Session): ExportPayloadV2 {
  const files: Session["files"] = {};
  for (const [id, file] of Object.entries(session.files)) {
    if (isDeniedSecretPath(file.path)) {
      files[id] = {
        ...file,
        oldContent: undefined,
        newContent: `// omitted: secret path ${file.path}\n`,
        isBinary: true,
      };
      continue;
    }
    files[id] = {
      ...file,
      oldContent:
        file.oldContent != null
          ? redactSecrets(file.oldContent).text
          : undefined,
      newContent:
        file.newContent != null
          ? redactSecrets(file.newContent).text
          : undefined,
    };
  }

  const nodes: Session["nodes"] = {};
  for (const [id, node] of Object.entries(session.nodes)) {
    nodes[id] = {
      ...node,
      content: redactSecrets(node.content).text,
      summary: node.summary != null ? redactSecrets(node.summary).text : undefined,
      meta: node.meta ? redactDeepStrings(node.meta) : undefined,
    };
  }

  const scrubbed: Session = {
    ...session,
    files,
    nodes,
    rawLog: session.rawLog.map((line) => redactSecrets(line).text),
    config: {
      ...session.config,
      env: session.config.env ? { "[redacted]": "true" } : undefined,
    },
    error: session.error ? redactSecrets(session.error).text : undefined,
    // Avoid duplicating huge event payloads inside snapshot
    eventLog: undefined,
  };

  const events = collectEventsForExport(session).map((ev) => ({
    ...ev,
    content: ev.content != null ? redactSecrets(ev.content).text : ev.content,
    summary: ev.summary != null ? redactSecrets(ev.summary).text : ev.summary,
    oldContent:
      ev.oldContent != null ? redactSecrets(ev.oldContent).text : ev.oldContent,
    newContent:
      ev.newContent != null ? redactSecrets(ev.newContent).text : ev.newContent,
    meta: ev.meta ? redactDeepStrings(ev.meta) : ev.meta,
  }));

  return {
    version: 2,
    exportedAt: Date.now(),
    session: scrubbed,
    events,
    rawLog: scrubbed.rawLog,
  };
}

function collectEventsForExport(session: Session): StreamEvent[] {
  if (session.eventLog?.length) return session.eventLog;
  return eventsFromSnapshotNodes(session);
}

export type ImportResult = {
  session: Session;
  events: StreamEvent[];
  /** True when rebuilt from event log rather than snapshot-only */
  fromEvents: boolean;
  formatVersion: 1 | 2;
};

/**
 * Accept v1 snapshot exports and v2 snapshot+events bundles.
 * Prefer replaying events when available for faithful rebuild.
 */
export function parseImportPayload(raw: unknown): ImportResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Import payload must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  // Bare Session
  if ("nodes" in obj && "files" in obj && "config" in obj && !("session" in obj)) {
    const session = obj as unknown as Session;
    const events = session.eventLog?.length
      ? session.eventLog
      : eventsFromSnapshotNodes(session);
    return { session, events, fromEvents: !!session.eventLog?.length, formatVersion: 1 };
  }

  const version = typeof obj.version === "number" ? obj.version : 1;
  const session = obj.session as Session | undefined;
  if (!session || typeof session !== "object") {
    throw new Error("Import payload missing session");
  }

  if (version >= 2 && Array.isArray(obj.events)) {
    const { events, errors } = migrateStreamEvents(obj.events, {
      sessionId: session.id,
      provider: "import",
    });
    return {
      session: {
        ...session,
        rawLog: Array.isArray(obj.rawLog)
          ? (obj.rawLog as string[])
          : session.rawLog ?? [],
      },
      events: [...events, ...errors],
      fromEvents: true,
      formatVersion: 2,
    };
  }

  // v1 or snapshot without events
  const recovered = session.eventLog?.length
    ? session.eventLog
    : eventsFromSnapshotNodes(session);
  return {
    session,
    events: recovered,
    fromEvents: !!session.eventLog?.length,
    formatVersion: 1,
  };
}

/** @deprecated use buildExportPayload — kept for type alias clarity */
export type { ExportPayload };
