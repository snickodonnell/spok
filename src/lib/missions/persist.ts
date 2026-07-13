/**
 * Filesystem persistence for Mission v1 under Spok data dir.
 * Pattern mirrors session-store-fs / automation jobs-fs: SPOK_HOME, atomic writes.
 *
 * Layout:
 *   $SPOK_HOME/missions/index.json
 *   $SPOK_HOME/missions/<id>/mission.json
 *   $SPOK_HOME/missions/<id>/checkpoints/<checkpointId>.json
 *
 * Restore/import is authority-neutral: loading never grants trust or execution power.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { ensureSpokHome, getSpokHome } from "@/lib/spok-paths";
import { materializeCheckpoint } from "./checkpoint";
import {
  buildMissionFromCreate,
  markAuthorityNeutralImport,
  sanitizeMission,
} from "./validate";
import type {
  Mission,
  MissionCheckpoint,
  MissionCreateInput,
  MissionDomainErrorCode,
  MissionMeta,
} from "./types";
import { MISSION_SAFE_ID, MISSION_SCHEMA_VERSION } from "./types";

export type PersistResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: MissionDomainErrorCode; error: string };

type MissionsIndexV1 = {
  version: typeof MISSION_SCHEMA_VERSION;
  updatedAt: number;
  ids: string[];
};

function ensureMissionsRoot(): string {
  const root = path.join(ensureSpokHome(), "missions");
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return root;
}

export function getMissionsRoot(): string {
  return path.join(getSpokHome(), "missions");
}

export function getMissionDir(id: string): string {
  if (!MISSION_SAFE_ID.test(id)) {
    throw new Error(`Invalid mission id: ${id}`);
  }
  return path.join(ensureMissionsRoot(), id);
}

function missionPath(id: string): string {
  return path.join(getMissionDir(id), "mission.json");
}

function checkpointDir(id: string): string {
  return path.join(getMissionDir(id), "checkpoints");
}

function indexPath(): string {
  return path.join(ensureMissionsRoot(), "index.json");
}

function atomicWriteJson(file: string, data: unknown): void {
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      renameSync(tmp, file);
    } catch (replaceError) {
      if (!existsSync(file)) throw replaceError;
      const backup = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.bak`;
      renameSync(file, backup);
      try {
        renameSync(tmp, file);
      } catch (promotionError) {
        try {
          renameSync(backup, file);
        } catch {
          /* keep backup */
        }
        throw promotionError;
      }
      try {
        unlinkSync(backup);
      } catch {
        /* stale backup ok */
      }
    }
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* preserve original */
    }
    throw error;
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

function loadIndex(): MissionsIndexV1 {
  const raw = readJsonFile<MissionsIndexV1>(indexPath());
  if (!raw || raw.version !== 1 || !Array.isArray(raw.ids)) {
    return { version: 1, updatedAt: 0, ids: [] };
  }
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    ids: raw.ids.filter((id) => typeof id === "string" && MISSION_SAFE_ID.test(id)),
  };
}

function saveIndex(ids: string[]): void {
  const unique = Array.from(new Set(ids));
  const payload: MissionsIndexV1 = {
    version: 1,
    updatedAt: Date.now(),
    ids: unique,
  };
  atomicWriteJson(indexPath(), payload);
}

export function toMissionMeta(mission: Mission): MissionMeta {
  return {
    version: 1,
    id: mission.id,
    projectId: mission.projectId,
    outcome: mission.outcome.slice(0, 500),
    status: mission.status,
    statusReason: mission.statusProvenance.reason,
    nextAction: mission.nextAction,
    repository: mission.repository,
    checkpointRef: mission.checkpointRef,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    milestoneCount: mission.milestones.length,
    workItemCount: mission.workItems.length,
  };
}

/** List mission metas (bounded projection; no full graphs). */
export function listMissions(): MissionMeta[] {
  const index = loadIndex();
  const metas: MissionMeta[] = [];
  for (const id of index.ids) {
    const mission = readMission(id);
    if (mission) metas.push(toMissionMeta(mission));
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one mission. Authority-neutral: never grants trust. */
export function readMission(id: string): Mission | null {
  if (!MISSION_SAFE_ID.test(id)) return null;
  const file = path.join(getSpokHome(), "missions", id, "mission.json");
  const raw = readJsonFile<unknown>(file);
  if (!raw) return null;
  const result = sanitizeMission(raw);
  return result.ok ? result.mission : null;
}

export function writeMission(mission: Mission): PersistResult<Mission> {
  const sanitized = sanitizeMission(mission);
  if (!sanitized.ok) {
    return { ok: false, code: sanitized.code, error: sanitized.error };
  }
  const next = { ...sanitized.mission, updatedAt: Date.now() };
  atomicWriteJson(missionPath(next.id), next);
  const index = loadIndex();
  if (!index.ids.includes(next.id)) {
    saveIndex([...index.ids, next.id]);
  } else {
    saveIndex(index.ids);
  }
  return { ok: true, value: next };
}

export function createMission(
  input: MissionCreateInput,
  now = Date.now()
): PersistResult<Mission> {
  const built = buildMissionFromCreate(input, now);
  if (!built.ok) {
    return { ok: false, code: built.code, error: built.error };
  }
  if (readMission(built.mission.id)) {
    return {
      ok: false,
      code: "conflict",
      error: `Mission ${built.mission.id} already exists`,
    };
  }
  return writeMission(built.mission);
}

/**
 * Import/restore a mission payload without granting trust or execution authority.
 */
export function importMission(
  input: unknown,
  source?: string,
  now = Date.now()
): PersistResult<Mission> {
  const sanitized = sanitizeMission(input, now);
  if (!sanitized.ok) {
    return { ok: false, code: sanitized.code, error: sanitized.error };
  }
  const neutral = markAuthorityNeutralImport(sanitized.mission, source, now);
  return writeMission(neutral);
}

export function saveCheckpoint(
  missionId: string,
  checkpoint: MissionCheckpoint
): PersistResult<MissionCheckpoint> {
  if (!MISSION_SAFE_ID.test(missionId)) {
    return { ok: false, code: "invalid_id", error: "Invalid mission id" };
  }
  if (checkpoint.missionId !== missionId) {
    return {
      ok: false,
      code: "invalid_mission",
      error: "Checkpoint missionId mismatch",
    };
  }
  if (!MISSION_SAFE_ID.test(checkpoint.id) && !/^ckpt_[A-Za-z0-9._-]+$/.test(checkpoint.id)) {
    return { ok: false, code: "invalid_id", error: "Invalid checkpoint id" };
  }
  const mission = readMission(missionId);
  if (!mission) {
    return { ok: false, code: "not_found", error: `Mission ${missionId} not found` };
  }
  const dir = checkpointDir(missionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${checkpoint.id}.json`);
  atomicWriteJson(file, checkpoint);
  const updated: Mission = {
    ...mission,
    checkpointRef: checkpoint.id,
    updatedAt: Date.now(),
  };
  const written = writeMission(updated);
  if (!written.ok) return written;
  return { ok: true, value: checkpoint };
}

/**
 * Materialize + persist a checkpoint from current mission state (no transcript).
 */
export function checkpointMission(
  missionId: string,
  opts?: {
    at?: number;
    changedAssumptions?: string[];
    risks?: string[];
    nextDecisions?: string[];
  }
): PersistResult<{ mission: Mission; checkpoint: MissionCheckpoint }> {
  const mission = readMission(missionId);
  if (!mission) {
    return { ok: false, code: "not_found", error: `Mission ${missionId} not found` };
  }
  const checkpoint = materializeCheckpoint({
    mission,
    at: opts?.at,
    changedAssumptions: opts?.changedAssumptions,
    risks: opts?.risks,
    nextDecisions: opts?.nextDecisions,
  });
  const saved = saveCheckpoint(missionId, checkpoint);
  if (!saved.ok) return saved;
  const next = readMission(missionId);
  if (!next) {
    return { ok: false, code: "not_found", error: "Mission missing after checkpoint" };
  }
  return { ok: true, value: { mission: next, checkpoint: saved.value } };
}

export function readCheckpoint(
  missionId: string,
  checkpointId: string
): MissionCheckpoint | null {
  if (!MISSION_SAFE_ID.test(missionId)) return null;
  const file = path.join(
    getSpokHome(),
    "missions",
    missionId,
    "checkpoints",
    `${checkpointId}.json`
  );
  return readJsonFile<MissionCheckpoint>(file);
}

/** List checkpoint ids for a mission (newest first by filename mtime if available). */
export function listCheckpointIds(missionId: string): string[] {
  if (!MISSION_SAFE_ID.test(missionId)) return [];
  const dir = path.join(getSpokHome(), "missions", missionId, "checkpoints");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));
}
