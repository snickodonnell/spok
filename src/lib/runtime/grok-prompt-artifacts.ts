/** Runtime-owned Grok prompt artifacts with deterministic retry identity. */

import { createHash } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { ensureSpokHome } from "@/lib/spok-paths";
import { canonicalizePath, isPathInsideRoot } from "@/lib/security/paths";

export const GROK_PROMPT_ARTIFACT_VERSION = 1 as const;
export const MAX_GROK_PROMPT_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PROMPT_RECOVERY_AGE_MS = 24 * 60 * 60 * 1000;

export type GrokPromptArtifact = {
  version: typeof GROK_PROMPT_ARTIFACT_VERSION;
  id: string;
  sessionId: string;
  runSpecId: string;
  path: string;
  format: "text" | "json";
  sha256: string;
  bytes: number;
  ephemeral: boolean;
  state: "ready" | "retained_failure" | "retained_handoff";
  createdAt: number;
  finalizedAt?: number;
};

export type PromptArtifactRecovery = {
  scanned: number;
  removed: string[];
  retained: string[];
  invalid: string[];
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function getGrokPromptArtifactsRoot(): string {
  return path.join(ensureSpokHome(), "runtime", "grok-prompts");
}

export function createGrokPromptArtifact(input: {
  sessionId: string;
  runSpecId: string;
  content: string;
  format: "text" | "json";
  ephemeral?: boolean;
  now?: number;
}): GrokPromptArtifact {
  const sessionId = assertSafeId(input.sessionId, "sessionId");
  const runSpecId = assertSafeId(input.runSpecId, "runSpecId");
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes <= 0) throw new Error("Prompt artifact content is empty");
  if (bytes > MAX_GROK_PROMPT_ARTIFACT_BYTES) {
    throw new Error(`Prompt artifact exceeds ${MAX_GROK_PROMPT_ARTIFACT_BYTES} bytes`);
  }
  if (input.format === "json") JSON.parse(input.content);

  const id = `gpa_${sha256(`${sessionId}\0${runSpecId}`).slice(0, 24)}`;
  const dir = artifactDir(sessionId, runSpecId);
  const extension = input.format === "json" ? "json" : "txt";
  const promptPath = canonicalizePath(path.join(dir, `prompt.${extension}`));
  const manifestPath = path.join(dir, "manifest.json");
  const contentHash = sha256(input.content);

  if (existsSync(manifestPath)) {
    const existing = readManifest(manifestPath);
    if (
      existing &&
      existing.id === id &&
      existing.sha256 === contentHash &&
      existing.bytes === bytes &&
      existing.format === input.format &&
      existing.path === promptPath
    ) {
      verifyGrokPromptArtifact(existing);
      return Object.freeze(existing);
    }
    throw new Error("Prompt artifact identity already exists with different content");
  }

  mkdirSync(dir, { recursive: true });
  const tempPrompt = `${promptPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tempPrompt, input.content, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPrompt, promptPath);

  const artifact: GrokPromptArtifact = {
    version: GROK_PROMPT_ARTIFACT_VERSION,
    id,
    sessionId,
    runSpecId,
    path: promptPath,
    format: input.format,
    sha256: contentHash,
    bytes,
    ephemeral: input.ephemeral !== false,
    state: "ready",
    createdAt: input.now ?? Date.now(),
  };
  atomicWriteJson(manifestPath, artifact);
  verifyGrokPromptArtifact(artifact);
  return Object.freeze(artifact);
}

export function verifyGrokPromptArtifact(
  reference: Pick<GrokPromptArtifact, "id" | "path" | "sha256" | "bytes">
): GrokPromptArtifact {
  if (!/^gpa_[a-f0-9]{24}$/.test(reference.id)) {
    throw new Error("Invalid prompt artifact id");
  }
  const root = canonicalizePath(getGrokPromptArtifactsRoot());
  const promptPath = canonicalizePath(reference.path);
  if (!isPathInsideRoot(promptPath, root)) {
    throw new Error("Prompt artifact path is outside managed storage");
  }
  if (!existsSync(promptPath) || lstatSync(promptPath).isSymbolicLink()) {
    throw new Error("Managed prompt artifact is missing or symbolic");
  }
  const realRoot = realpathSync(root);
  const realPrompt = realpathSync(promptPath);
  if (!isPathInsideRoot(realPrompt, realRoot)) {
    throw new Error("Managed prompt artifact resolves outside storage");
  }
  const manifestPath = path.join(path.dirname(promptPath), "manifest.json");
  const manifest = readManifest(manifestPath);
  if (!manifest || manifest.id !== reference.id || manifest.path !== promptPath) {
    throw new Error("Prompt artifact manifest does not match the run contract");
  }
  const content = readFileSync(promptPath);
  if (content.byteLength !== reference.bytes || manifest.bytes !== reference.bytes) {
    throw new Error("Prompt artifact size does not match the run contract");
  }
  const contentHash = createHash("sha256").update(content).digest("hex");
  if (contentHash !== reference.sha256 || manifest.sha256 !== reference.sha256) {
    throw new Error("Prompt artifact hash does not match the run contract");
  }
  return Object.freeze(manifest);
}

export function finalizeGrokPromptArtifact(
  reference: Pick<GrokPromptArtifact, "id" | "path" | "sha256" | "bytes">,
  outcome: "completed" | "cancelled" | "failed",
  now = Date.now()
): { removed: boolean; retained: boolean } {
  const artifact = verifyGrokPromptArtifact(reference);
  const dir = path.dirname(artifact.path);
  if (artifact.ephemeral && outcome !== "failed") {
    assertManagedArtifactDir(dir);
    rmSync(dir, { recursive: true, force: true });
    return { removed: true, retained: false };
  }
  const retained: GrokPromptArtifact = {
    ...artifact,
    state: outcome === "completed" ? "retained_handoff" : "retained_failure",
    finalizedAt: now,
  };
  atomicWriteJson(path.join(dir, "manifest.json"), retained);
  return { removed: false, retained: true };
}

/** Remove stale ephemeral artifacts left by crash/approval abandonment. */
export function recoverGrokPromptArtifacts(input: {
  now?: number;
  maxAgeMs?: number;
  activeRunSpecIds?: Iterable<string>;
} = {}): PromptArtifactRecovery {
  const root = getGrokPromptArtifactsRoot();
  const result: PromptArtifactRecovery = {
    scanned: 0,
    removed: [],
    retained: [],
    invalid: [],
  };
  if (!existsSync(root)) return result;
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_PROMPT_RECOVERY_AGE_MS;
  const active = new Set(input.activeRunSpecIds ?? []);

  for (const sessionEntry of readdirSync(root, { withFileTypes: true })) {
    if (!sessionEntry.isDirectory()) continue;
    const sessionPath = path.join(root, sessionEntry.name);
    for (const runEntry of readdirSync(sessionPath, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      result.scanned += 1;
      const dir = path.join(sessionPath, runEntry.name);
      try {
        assertManagedArtifactDir(dir);
        const manifest = readManifest(path.join(dir, "manifest.json"));
        const age = now - statSync(dir).mtimeMs;
        if (manifest && active.has(manifest.runSpecId)) {
          result.retained.push(manifest.id);
          continue;
        }
        if (
          manifest &&
          (!manifest.ephemeral ||
            manifest.state === "retained_failure" ||
            manifest.state === "retained_handoff")
        ) {
          result.retained.push(manifest.id);
          continue;
        }
        if (age < maxAgeMs) {
          result.retained.push(manifest?.id ?? runEntry.name);
          continue;
        }
        rmSync(dir, { recursive: true, force: true });
        result.removed.push(manifest?.id ?? runEntry.name);
      } catch {
        result.invalid.push(runEntry.name);
      }
    }
  }
  return result;
}

export function getGrokDebugArtifactPath(sessionId: string, runSpecId: string): string {
  const dir = artifactDir(assertSafeId(sessionId, "sessionId"), assertSafeId(runSpecId, "runSpecId"));
  mkdirSync(dir, { recursive: true });
  return canonicalizePath(path.join(dir, "grok-debug.log"));
}

function artifactDir(sessionId: string, runSpecId: string): string {
  return path.join(getGrokPromptArtifactsRoot(), sessionId, runSpecId);
}

function assertManagedArtifactDir(dir: string): void {
  if (!isPathInsideRoot(dir, getGrokPromptArtifactsRoot())) {
    throw new Error("Prompt artifact directory escapes managed storage");
  }
}

function assertSafeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID.test(trimmed)) throw new Error(`Invalid ${label}`);
  return trimmed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readManifest(file: string): GrokPromptArtifact | null {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as GrokPromptArtifact;
    if (
      value.version !== GROK_PROMPT_ARTIFACT_VERSION ||
      !SAFE_ID.test(value.sessionId) ||
      !SAFE_ID.test(value.runSpecId) ||
      !/^gpa_[a-f0-9]{24}$/.test(value.id) ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isInteger(value.bytes) ||
      value.bytes <= 0 ||
      !["text", "json"].includes(value.format) ||
      !["ready", "retained_failure", "retained_handoff"].includes(value.state) ||
      typeof value.ephemeral !== "boolean" ||
      typeof value.path !== "string"
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const nonce = Math.random().toString(36).slice(2);
  const temp = `${file}.${process.pid}.${nonce}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      renameSync(temp, file);
    } catch (replaceError) {
      if (!existsSync(file)) throw replaceError;
      const backup = `${file}.${process.pid}.${nonce}.bak`;
      renameSync(file, backup);
      try {
        renameSync(temp, file);
      } catch (promotionError) {
        try {
          renameSync(backup, file);
        } catch {
          /* preserve the backup for recovery */
        }
        throw promotionError;
      }
      try {
        unlinkSync(backup);
      } catch {
        /* stale backup is safer than losing artifact metadata */
      }
    }
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      /* preserve the original error */
    }
    throw error;
  }
}
