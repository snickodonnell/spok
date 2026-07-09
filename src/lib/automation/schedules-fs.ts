import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { ensureSpokHome } from "@/lib/spok-paths";
import {
  computeNextRunAt,
  type ScheduleDefinition,
  type ScheduleIntervalUnit,
} from "./types";

function schedulesPath(): string {
  return path.join(ensureSpokHome(), "schedules.json");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const UNITS = new Set<ScheduleIntervalUnit>(["minutes", "hours", "days"]);

export function sanitizeSchedule(
  input: unknown,
  defaults?: Partial<ScheduleDefinition>
): ScheduleDefinition | null {
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
  const prompt =
    typeof input.prompt === "string" && input.prompt.trim()
      ? input.prompt.trim()
      : defaults?.prompt;
  if (!prompt) return null;

  const unit =
    typeof input.unit === "string" && UNITS.has(input.unit as ScheduleIntervalUnit)
      ? (input.unit as ScheduleIntervalUnit)
      : defaults?.unit ?? "hours";
  const everyRaw =
    typeof input.every === "number" && Number.isFinite(input.every)
      ? Math.floor(input.every)
      : defaults?.every ?? 24;
  const every = Math.max(1, Math.min(unit === "minutes" ? 7 * 24 * 60 : 365, everyRaw));

  const now = Date.now();
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : defaults?.id ?? `sched-${nanoid(8)}`;

  const createdAt =
    typeof input.createdAt === "number" ? input.createdAt : defaults?.createdAt ?? now;

  return {
    id,
    name,
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : (defaults?.enabled ?? true),
    cwd,
    prompt,
    every,
    unit,
    requireTrusted:
      typeof input.requireTrusted === "boolean"
        ? input.requireTrusted
        : (defaults?.requireTrusted ?? true),
    isolate:
      typeof input.isolate === "boolean"
        ? input.isolate
        : (defaults?.isolate ?? true),
    createdAt,
    updatedAt: now,
    lastRunAt:
      typeof input.lastRunAt === "number"
        ? input.lastRunAt
        : defaults?.lastRunAt,
    nextRunAt:
      typeof input.nextRunAt === "number"
        ? input.nextRunAt
        : defaults?.nextRunAt ?? computeNextRunAt(now, every, unit),
    lastJobId:
      typeof input.lastJobId === "string"
        ? input.lastJobId
        : defaults?.lastJobId,
    lastStatus:
      (typeof input.lastStatus === "string"
        ? (input.lastStatus as ScheduleDefinition["lastStatus"])
        : defaults?.lastStatus),
    description:
      typeof input.description === "string"
        ? input.description
        : defaults?.description,
  };
}

export function loadSchedules(): ScheduleDefinition[] {
  const p = schedulesPath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : isObject(raw) && Array.isArray(raw.schedules)
        ? raw.schedules
        : [];
    return list
      .map((s) => sanitizeSchedule(s))
      .filter((s): s is ScheduleDefinition => !!s);
  } catch {
    return [];
  }
}

export function saveSchedules(schedules: ScheduleDefinition[]): void {
  ensureSpokHome();
  const dir = path.dirname(schedulesPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    schedulesPath(),
    JSON.stringify(
      {
        version: 1,
        schedules: schedules.map((s) => sanitizeSchedule(s)).filter(Boolean),
      },
      null,
      2
    ),
    "utf8"
  );
}

export function upsertSchedule(
  input: unknown
): { schedule: ScheduleDefinition; all: ScheduleDefinition[] } | { error: string } {
  const all = loadSchedules();
  const existing =
    isObject(input) && typeof input.id === "string"
      ? all.find((s) => s.id === input.id)
      : undefined;
  const schedule = sanitizeSchedule(input, existing);
  if (!schedule) return { error: "Invalid schedule (need name, cwd, prompt)" };
  const next = all.filter((s) => s.id !== schedule.id);
  next.push(schedule);
  next.sort((a, b) => a.name.localeCompare(b.name));
  saveSchedules(next);
  return { schedule, all: next };
}

export function deleteSchedule(id: string): ScheduleDefinition[] {
  const next = loadSchedules().filter((s) => s.id !== id);
  saveSchedules(next);
  return next;
}

export function markScheduleRun(
  id: string,
  patch: {
    lastRunAt: number;
    lastJobId?: string;
    lastStatus?: ScheduleDefinition["lastStatus"];
    nextRunAt?: number;
  }
): ScheduleDefinition | null {
  const all = loadSchedules();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const s = all[idx];
  const updated: ScheduleDefinition = {
    ...s,
    lastRunAt: patch.lastRunAt,
    lastJobId: patch.lastJobId ?? s.lastJobId,
    lastStatus: patch.lastStatus ?? s.lastStatus,
    nextRunAt:
      patch.nextRunAt ??
      computeNextRunAt(patch.lastRunAt, s.every, s.unit),
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  saveSchedules(all);
  return updated;
}

/** Schedules that are due to run now. */
export function listDueSchedules(now = Date.now()): ScheduleDefinition[] {
  return loadSchedules().filter(
    (s) =>
      s.enabled &&
      s.prompt.trim() &&
      (s.nextRunAt == null || s.nextRunAt <= now)
  );
}
