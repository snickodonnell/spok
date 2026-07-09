import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UNTRACKED_BYTES = 512 * 1024;

/**
 * Return working-tree git status + diffs, including untracked file contents
 * so newly created files (e.g. plan.md) appear in Spok's live Diff panel.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || process.cwd();

  if (!existsSync(cwd)) {
    return Response.json({ error: "Directory not found" }, { status: 404 });
  }

  const gitDir = path.join(cwd, ".git");
  if (!existsSync(gitDir)) {
    return Response.json({
      error: "Not a git repository",
      diff: "",
      status: "",
      files: [],
      untracked: [],
      cwd,
      timestamp: Date.now(),
    });
  }

  try {
    const [{ stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain", "-uall"], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      }),
      execFileAsync("git", ["diff", "HEAD"], {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
      }).catch(async () =>
        execFileAsync("git", ["diff"], { cwd, maxBuffer: 20 * 1024 * 1024 })
      ),
    ]);

    // Also capture unstaged + staged
    let staged = "";
    try {
      const r = await execFileAsync("git", ["diff", "--cached"], {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
      });
      staged = r.stdout || "";
    } catch {
      /* ignore */
    }

    const combinedDiff = [staged, diff].filter(Boolean).join("\n");

    const untracked: string[] = [];
    const files: Array<{
      path: string;
      status: string;
      oldContent?: string;
      newContent?: string;
    }> = [];

    for (const line of status.split("\n")) {
      if (!line.trim()) continue;
      // porcelain: XY PATH or XY ORIG -> PATH
      const code = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop()!.trim();
      }
      // Unquoted paths; strip quotes if present
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = JSON.parse(filePath) as string;
      }

      if (code === "??" || code[0] === "?" || code[1] === "?") {
        untracked.push(filePath);
        const abs = path.join(cwd, filePath);
        try {
          if (existsSync(abs) && statSync(abs).isFile()) {
            const size = statSync(abs).size;
            if (size <= MAX_UNTRACKED_BYTES) {
              const content = readFileSync(abs, "utf8");
              files.push({
                path: filePath.replace(/\\/g, "/"),
                status: "added",
                oldContent: "",
                newContent: content,
              });
            } else {
              files.push({
                path: filePath.replace(/\\/g, "/"),
                status: "added",
                oldContent: "",
                newContent: `// file too large to preview (${size} bytes)\n`,
              });
            }
          }
        } catch {
          /* skip unreadable */
        }
      } else if (code.includes("A") || code.includes("M") || code.includes("D")) {
        // Modified/added tracked — content already in unified diff; still list path
        const st =
          code.includes("D") ? "deleted" : code.includes("A") ? "added" : "modified";
        // Avoid duplicate if also in untracked list
        if (!files.some((f) => f.path === filePath.replace(/\\/g, "/"))) {
          // Prefer diff parse; optional content fill for safety
          files.push({
            path: filePath.replace(/\\/g, "/"),
            status: st,
          });
        }
      }
    }

    return Response.json({
      status,
      diff: combinedDiff,
      untracked,
      files,
      cwd,
      timestamp: Date.now(),
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "git failed",
        diff: "",
        status: "",
        files: [],
      },
      { status: 500 }
    );
  }
}
