import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { nanoid } from "nanoid";
import { ensureSpokHome } from "@/lib/spok-paths";
import type {
  ChannelDefinition,
  ChannelEventRecord,
  ChannelTargetMode,
} from "./types";
import { AUTOMATION_DEFAULTS } from "./types";

function channelsPath(): string {
  return path.join(ensureSpokHome(), "channels.json");
}

function channelEventsPath(): string {
  return path.join(ensureSpokHome(), "channel-events.ndjson");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const MODES = new Set<ChannelTargetMode>([
  "queue_background",
  "new_session",
  "notify_only",
]);

export function generateChannelSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function sanitizeChannel(
  input: unknown,
  defaults?: Partial<ChannelDefinition>
): ChannelDefinition | null {
  if (!isObject(input)) return null;
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : defaults?.name;
  if (!name) return null;
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? input.cwd.trim()
      : defaults?.cwd;
  if (!cwd) return null;

  const now = Date.now();
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : defaults?.id ?? `ch-${nanoid(8)}`;

  const secret =
    typeof input.secret === "string" && input.secret.trim()
      ? input.secret.trim()
      : defaults?.secret ?? generateChannelSecret();

  const targetMode =
    typeof input.targetMode === "string" &&
    MODES.has(input.targetMode as ChannelTargetMode)
      ? (input.targetMode as ChannelTargetMode)
      : defaults?.targetMode ?? "queue_background";

  const promptTemplate =
    typeof input.promptTemplate === "string" && input.promptTemplate.trim()
      ? input.promptTemplate.trim()
      : defaults?.promptTemplate ??
        "External event: {{title}}\n\n{{payload}}";

  return {
    id,
    name,
    description:
      typeof input.description === "string"
        ? input.description
        : defaults?.description,
    enabled: input.enabled === false ? false : defaults?.enabled !== false,
    secret,
    cwd,
    targetMode,
    promptTemplate,
    isolate: input.isolate === false ? false : defaults?.isolate !== false,
    requireTrusted:
      input.requireTrusted === false
        ? false
        : defaults?.requireTrusted !== false,
    createdAt:
      typeof input.createdAt === "number"
        ? input.createdAt
        : defaults?.createdAt ?? now,
    updatedAt: now,
    lastEventAt:
      typeof input.lastEventAt === "number"
        ? input.lastEventAt
        : defaults?.lastEventAt,
    eventCount:
      typeof input.eventCount === "number"
        ? input.eventCount
        : defaults?.eventCount ?? 0,
  };
}

export function loadChannels(): ChannelDefinition[] {
  const p = channelsPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : isObject(raw) && Array.isArray(raw.channels)
        ? raw.channels
        : [];
    return list
      .map((c) => sanitizeChannel(c))
      .filter((c): c is ChannelDefinition => !!c);
  } catch {
    return [];
  }
}

export function saveChannels(channels: ChannelDefinition[]): void {
  ensureSpokHome();
  writeFileSync(
    channelsPath(),
    JSON.stringify({ version: 1, channels }, null, 2),
    "utf8"
  );
}

export function upsertChannel(
  input: unknown
): { channel: ChannelDefinition; all: ChannelDefinition[] } | { error: string } {
  const all = loadChannels();
  if (
    all.length >= AUTOMATION_DEFAULTS.maxChannels &&
    !(isObject(input) && typeof input.id === "string" && all.some((c) => c.id === input.id))
  ) {
    return { error: `Max ${AUTOMATION_DEFAULTS.maxChannels} channels` };
  }
  const existing =
    isObject(input) && typeof input.id === "string"
      ? all.find((c) => c.id === input.id)
      : undefined;
  const channel = sanitizeChannel(input, existing);
  if (!channel) return { error: "Invalid channel (need name, cwd)" };
  const next = all.filter((c) => c.id !== channel.id);
  next.push(channel);
  next.sort((a, b) => a.name.localeCompare(b.name));
  saveChannels(next);
  return { channel, all: next };
}

export function deleteChannel(id: string): ChannelDefinition[] {
  const next = loadChannels().filter((c) => c.id !== id);
  saveChannels(next);
  return next;
}

export function findChannelById(id: string): ChannelDefinition | undefined {
  return loadChannels().find((c) => c.id === id);
}

export function applyChannelTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

export function appendChannelEvent(event: ChannelEventRecord): void {
  try {
    ensureSpokHome();
    appendFileSync(channelEventsPath(), JSON.stringify(event) + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

export function listRecentChannelEvents(
  limit = AUTOMATION_DEFAULTS.maxChannelEvents
): ChannelEventRecord[] {
  const p = channelEventsPath();
  if (!existsSync(p)) return [];
  try {
    const lines = readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
    const slice = lines.slice(-limit);
    const out: ChannelEventRecord[] = [];
    for (const line of slice) {
      try {
        const e = JSON.parse(line) as ChannelEventRecord;
        if (e && typeof e.id === "string") out.push(e);
      } catch {
        /* skip */
      }
    }
    return out.reverse();
  } catch {
    return [];
  }
}

export function bumpChannelEvent(id: string): ChannelDefinition | null {
  const all = loadChannels();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  all[idx] = {
    ...all[idx],
    lastEventAt: Date.now(),
    eventCount: (all[idx].eventCount ?? 0) + 1,
    updatedAt: Date.now(),
  };
  saveChannels(all);
  return all[idx];
}

/** Redact secret for UI (show last 4 only). */
export function redactChannelSecret(secret: string): string {
  if (secret.length <= 4) return "••••";
  return `••••${secret.slice(-4)}`;
}
