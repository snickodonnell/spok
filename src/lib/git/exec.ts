import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

/**
 * Run git with an explicit argv array (never a shell).
 * Returns stdout/stderr even on non-zero exit when `allowFail` is true.
 */
export async function gitExec(
  cwd: string,
  args: string[],
  opts?: { maxBuffer?: number; allowFail?: boolean; timeoutMs?: number }
): Promise<GitExecResult> {
  const maxBuffer = opts?.maxBuffer ?? 20 * 1024 * 1024;
  try {
    const r = await execFileAsync("git", args, {
      cwd,
      maxBuffer,
      timeout: opts?.timeoutMs ?? 120_000,
      windowsHide: true,
      env: {
        ...process.env,
        // Keep porcelain stable
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
      },
    });
    return {
      stdout: r.stdout?.toString() ?? "",
      stderr: r.stderr?.toString() ?? "",
      code: 0,
    };
  } catch (e) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
      message?: string;
      killed?: boolean;
    };
    const result: GitExecResult = {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? err.message ?? "git failed",
      code: typeof err.code === "number" ? err.code : 1,
    };
    if (opts?.allowFail) return result;
    const msg = (result.stderr || result.stdout || "git failed").trim();
    throw new Error(msg.slice(0, 2000));
  }
}

/** True when cwd has a .git dir or file (worktree). */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await gitExec(cwd, ["rev-parse", "--is-inside-work-tree"], {
    allowFail: true,
    maxBuffer: 1024 * 64,
  });
  return r.code === 0 && r.stdout.trim() === "true";
}
