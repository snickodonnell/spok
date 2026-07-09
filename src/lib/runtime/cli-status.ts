/**
 * Grok CLI readiness (Phase 7) — **server / Node only**.
 *
 * Spok does **not** implement Grok login. Users authenticate with the native
 * Grok CLI, then launch Spok. This module only checks:
 *   - binary resolvable on PATH
 *   - version string when `--version` / `-V` works
 *
 * Auth state probes are intentionally omitted until product confirms the
 * official CLI command/output for "logged in".
 *
 * Client-safe auth hints live in `./auth-hints`.
 */

import { spawn } from "child_process";
import { platform } from "os";
import { CLI_AUTH_GUIDANCE } from "./auth-hints";

export type CliStatus = {
  command: string;
  found: boolean;
  version: string | null;
  versionRaw: string | null;
  /** Milliseconds for the probe */
  probeMs: number;
  platform: string;
  /**
   * Always false until an official auth probe is wired.
   * UI should not claim "logged out" — only "CLI missing" or "CLI present".
   */
  authChecked: false;
  /** Guidance when users hit auth errors mid-run */
  authGuidance: string;
  error?: string;
};

export { CLI_AUTH_GUIDANCE };

function runCapture(
  command: string,
  args: string[],
  timeoutMs = 8000
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: {
      code: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        env: process.env,
      });
    } catch (e) {
      finish({
        code: 1,
        stdout: "",
        stderr: "",
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({
        code: null,
        stdout,
        stderr,
        error: "probe_timeout",
      });
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr?.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        code: 1,
        stdout,
        stderr,
        error: (err as NodeJS.ErrnoException).code || err.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr });
    });
  });
}

/** Windows: try bare command, then .cmd via cmd.exe if ENOENT. */
async function probeCommand(
  command: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  const first = await runCapture(command, args);
  if (
    platform() === "win32" &&
    first.error &&
    (first.error === "ENOENT" || first.error.includes("ENOENT"))
  ) {
    const quoted = [command, ...args]
      .map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(" ");
    return runCapture("cmd.exe", ["/d", "/s", "/c", quoted]);
  }
  return first;
}

function parseVersion(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // Common shapes: "grok 1.2.3", "1.2.3", "v1.2.3"
  const m = text.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/i);
  if (m) return m[1];
  // First non-empty line, truncated
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim();
  return line ? line.slice(0, 80) : null;
}

/** Windows cmd "not recognized" / shell missing binary messages. */
function looksLikeMissingBinary(stdout: string, stderr: string, error?: string): boolean {
  if (error === "ENOENT" || error?.includes("ENOENT")) return true;
  const text = `${stdout}\n${stderr}\n${error ?? ""}`.toLowerCase();
  return (
    text.includes("is not recognized") ||
    text.includes("not found") ||
    text.includes("no such file") ||
    text.includes("command not found") ||
    text.includes("cannot find the path")
  );
}

export async function probeCliStatus(
  command = process.env.SPOK_GROK_CMD?.trim() || "grok"
): Promise<CliStatus> {
  const started = Date.now();
  const base: Omit<CliStatus, "found" | "version" | "versionRaw" | "probeMs" | "error"> = {
    command,
    platform: platform(),
    authChecked: false,
    authGuidance: CLI_AUTH_GUIDANCE,
  };

  // Prefer --version; fall back to -V / version / --help
  for (const args of [["--version"], ["-V"], ["version"], ["--help"]] as string[][]) {
    const result = await probeCommand(command, args);
    const combined = `${result.stdout}\n${result.stderr}`;
    if (looksLikeMissingBinary(result.stdout, result.stderr, result.error)) {
      return {
        ...base,
        found: false,
        version: null,
        versionRaw: null,
        probeMs: Date.now() - started,
        error: "not_found",
      };
    }
    if (result.error === "probe_timeout") {
      // Binary likely exists but hung — still "found"
      return {
        ...base,
        found: true,
        version: null,
        versionRaw: null,
        probeMs: Date.now() - started,
        error: "probe_timeout",
      };
    }
    // Require success or a parseable version; non-zero "not recognized" already handled
    if (result.code === 0) {
      return {
        ...base,
        found: true,
        version: parseVersion(combined),
        versionRaw: combined.trim().slice(0, 500) || null,
        probeMs: Date.now() - started,
      };
    }
    const ver = parseVersion(combined);
    // Only trust version parse on non-zero if output doesn't look like shell noise
    if (ver && combined.length < 200 && !/error|not recognized|usage/i.test(combined)) {
      return {
        ...base,
        found: true,
        version: ver,
        versionRaw: combined.trim().slice(0, 500) || null,
        probeMs: Date.now() - started,
      };
    }
  }

  return {
    ...base,
    found: false,
    version: null,
    versionRaw: null,
    probeMs: Date.now() - started,
    error: "not_found",
  };
}


