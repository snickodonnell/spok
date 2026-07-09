import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Return working-tree git diff for a directory (for live repo watching).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || process.cwd();

  if (!existsSync(cwd)) {
    return Response.json({ error: "Directory not found" }, { status: 400 });
  }

  const gitDir = path.join(cwd, ".git");
  if (!existsSync(gitDir)) {
    return Response.json({ error: "Not a git repository", diff: "", status: "" }, { status: 200 });
  }

  try {
    const [{ stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain"], { cwd, maxBuffer: 10 * 1024 * 1024 }),
      execFileAsync("git", ["diff", "HEAD"], { cwd, maxBuffer: 20 * 1024 * 1024 }).catch(
        async () =>
          execFileAsync("git", ["diff"], { cwd, maxBuffer: 20 * 1024 * 1024 })
      ),
    ]);

    // Also include untracked file contents as synthetic adds when small
    const untracked: string[] = [];
    for (const line of status.split("\n")) {
      if (line.startsWith("??")) {
        untracked.push(line.slice(3).trim());
      }
    }

    return Response.json({
      status,
      diff,
      untracked,
      cwd,
      timestamp: Date.now(),
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "git failed",
        diff: "",
        status: "",
      },
      { status: 500 }
    );
  }
}
