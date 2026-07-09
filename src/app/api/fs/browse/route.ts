import { readdir, stat, access } from "fs/promises";
import { constants } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type BrowseEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  isGitRepo?: boolean;
  isHidden?: boolean;
};

export type BrowseResponse = {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  isGitRepo: boolean;
  error?: string;
  roots?: string[];
  home?: string;
};

function isWindows() {
  return process.platform === "win32";
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function hasGit(dir: string): Promise<boolean> {
  return exists(path.join(dir, ".git"));
}

/** List Windows drive letters that exist */
async function listWindowsDrives(): Promise<string[]> {
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    if (await exists(root)) drives.push(root);
  }
  return drives;
}

function getParent(dir: string): string | null {
  const normalized = path.resolve(dir);
  const parent = path.dirname(normalized);
  if (parent === normalized) return null;
  // On Windows, path.dirname("C:\\") is "C:\\"
  if (isWindows() && /^[A-Za-z]:\\?$/.test(normalized)) return null;
  return parent;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawPath = searchParams.get("path");
  const showHidden = searchParams.get("hidden") === "1";
  const dirsOnly = searchParams.get("dirsOnly") !== "0";

  const home = os.homedir();
  const roots = isWindows()
    ? await listWindowsDrives()
    : ["/", home];

  // Empty path → home (or roots listing mode)
  let target = rawPath?.trim() || home;

  // Normalize Windows paths: accept forward slashes
  if (isWindows()) {
    target = target.replace(/\//g, "\\");
  }
  target = path.resolve(target);

  if (!(await exists(target))) {
    return Response.json(
      {
        path: target,
        parent: getParent(target),
        entries: [],
        isGitRepo: false,
        error: `Path does not exist: ${target}`,
        roots,
        home,
      } satisfies BrowseResponse,
      { status: 404 }
    );
  }

  if (!(await isDir(target))) {
    // If it's a file, browse its parent
    target = path.dirname(target);
  }

  try {
    const names = await readdir(target);
    const entries: BrowseEntry[] = [];

    await Promise.all(
      names.map(async (name) => {
        const isHidden = name.startsWith(".") || (isWindows() && name.startsWith("$"));
        if (!showHidden && isHidden) return;

        const full = path.join(target, name);
        try {
          const s = await stat(full);
          if (s.isDirectory()) {
            entries.push({
              name,
              path: full,
              type: "directory",
              isGitRepo: await hasGit(full),
              isHidden,
            });
          } else if (!dirsOnly) {
            entries.push({
              name,
              path: full,
              type: "file",
              isHidden,
            });
          }
        } catch {
          /* skip inaccessible */
        }
      })
    );

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    const body: BrowseResponse = {
      path: target,
      parent: getParent(target),
      entries,
      isGitRepo: await hasGit(target),
      roots,
      home,
    };

    return Response.json(body);
  } catch (e) {
    return Response.json(
      {
        path: target,
        parent: getParent(target),
        entries: [],
        isGitRepo: false,
        error: e instanceof Error ? e.message : "Failed to read directory",
        roots,
        home,
      } satisfies BrowseResponse,
      { status: 500 }
    );
  }
}
