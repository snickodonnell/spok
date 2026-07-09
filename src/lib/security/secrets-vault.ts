/**
 * Local secrets vault (Phase 6).
 * Stores opaque tokens under ~/.spok/secrets/ with AES-256-GCM.
 * Key material lives in ~/.spok/secrets/.key (mode 0o600 where supported).
 * Desktop builds may later swap this for OS keychain via Tauri; the API stays stable.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  unlinkSync,
} from "fs";
import path from "path";
import { ensureSpokHome, getSpokHome } from "../spok-paths";

const VAULT_DIR = "secrets";
const KEY_FILE = ".key";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

function vaultDir(): string {
  const dir = path.join(getSpokHome(), VAULT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* Windows may ignore */
    }
  }
  return dir;
}

function keyPath(): string {
  return path.join(vaultDir(), KEY_FILE);
}

function ensureKey(): Buffer {
  ensureSpokHome();
  const kp = keyPath();
  if (existsSync(kp)) {
    const raw = readFileSync(kp);
    if (raw.length >= KEY_LEN) return raw.subarray(0, KEY_LEN);
  }
  // Random key material (AES-256). Machine-local vault; OS keychain is a future upgrade.
  const key = randomBytes(KEY_LEN);
  writeFileSync(kp, key);
  try {
    chmodSync(kp, 0o600);
  } catch {
    /* Windows */
  }
  return key;
}

function secretPath(id: string): string {
  // Safe filename: only alnum, dash, underscore, dot
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
  if (!safe) throw new Error("Invalid secret id");
  return path.join(vaultDir(), `${safe}.enc`);
}

export function writeSecret(id: string, value: string): { id: string; bytes: number } {
  const key = ensureKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: iv | tag | ciphertext
  const payload = Buffer.concat([iv, tag, enc]);
  const fp = secretPath(id);
  writeFileSync(fp, payload);
  try {
    chmodSync(fp, 0o600);
  } catch {
    /* Windows */
  }
  return { id, bytes: payload.length };
}

export function readSecret(id: string): string | null {
  const fp = secretPath(id);
  if (!existsSync(fp)) return null;
  const key = ensureKey();
  const buf = readFileSync(fp);
  if (buf.length < IV_LEN + 16) return null;
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function deleteSecret(id: string): boolean {
  const fp = secretPath(id);
  if (!existsSync(fp)) return false;
  unlinkSync(fp);
  return true;
}

export function listSecretIds(): string[] {
  const dir = vaultDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".enc"))
    .map((f) => f.replace(/\.enc$/, ""));
}

/** Redacted vault summary for diagnostics — never returns values. */
export function vaultDiagnostics(): {
  path: string;
  secretCount: number;
  hasKey: boolean;
} {
  const dir = path.join(getSpokHome(), VAULT_DIR);
  return {
    path: dir,
    secretCount: existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".enc")).length
      : 0,
    hasKey: existsSync(keyPath()),
  };
}
