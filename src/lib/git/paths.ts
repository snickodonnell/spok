import path from "path";
import { canonicalizePath, isPathInsideRoot } from "@/lib/security/paths";
import { normalizeRepoRelativePath } from "@/lib/security/secrets";

/**
 * Resolve user-supplied paths for git ops relative to cwd.
 * Rejects escape outside the workspace root.
 */
export function resolveRepoPaths(
  cwd: string,
  paths: string[] | undefined
): string[] {
  if (!paths?.length) return [];
  const root = canonicalizePath(cwd);

  return paths.map((p) => {
    const raw = p.trim();
    if (!raw) throw new Error("Empty path");

    const isAbs =
      path.isAbsolute(raw) ||
      /^[A-Za-z]:[\\/]/.test(raw) ||
      raw.startsWith("\\\\");

    let abs: string;
    if (isAbs) {
      abs = canonicalizePath(raw);
    } else {
      const rel = normalizeRepoRelativePath(raw);
      if (
        rel === ".." ||
        rel.startsWith("../") ||
        rel.includes("/../") ||
        rel.endsWith("/..")
      ) {
        throw new Error(`Invalid path: ${p}`);
      }
      abs = canonicalizePath(path.join(cwd, rel));
    }

    if (!isPathInsideRoot(abs, root)) {
      throw new Error(`Path outside workspace: ${p}`);
    }

    const relative = path.relative(root, abs).replace(/\\/g, "/");
    return relative || ".";
  });
}

/** Resolve a worktree target path (absolute or relative to cwd). */
export function resolveWorktreeAbsPath(cwd: string, worktreePath: string): string {
  const raw = worktreePath.trim();
  if (!raw) throw new Error("Worktree path required");
  const isAbs =
    path.isAbsolute(raw) ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith("\\\\");
  return canonicalizePath(isAbs ? raw : path.join(cwd, raw));
}

/**
 * Worktrees may live as siblings of the repo or under any trusted root.
 * Refuse creating on top of the main worktree itself.
 */
export function assertWorktreeLocationAllowed(opts: {
  absWorktreePath: string;
  repoRoot: string;
  trustedRoots: string[];
}): void {
  const abs = canonicalizePath(opts.absWorktreePath);
  const repo = canonicalizePath(opts.repoRoot);

  if (abs.toLowerCase() === repo.toLowerCase()) {
    throw new Error("Worktree path cannot be the main repository checkout");
  }

  // Disallow nesting a worktree *inside* the main working tree (git allows
  // it in some cases but it confuses isolation and status).
  if (isPathInsideRoot(abs, repo)) {
    throw new Error(
      "Worktree path must not be inside the main working tree — use a sibling directory"
    );
  }

  const parent = path.dirname(repo);
  const underParent = isPathInsideRoot(abs, parent);
  const underTrusted = opts.trustedRoots.some((r) => isPathInsideRoot(abs, r));

  if (!underParent && !underTrusted) {
    throw new Error(
      "Worktree path must be a sibling of the repo (or under a trusted workspace root)"
    );
  }
}

/** Safe local branch / worktree branch names only. */
export function isValidGitRefName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > 200) return false;
  // Disallow git option-looking names and path tricks
  if (n.startsWith("-") || n.includes("..") || n.includes("\\")) return false;
  if (n.endsWith("/") || n.startsWith("/") || n.includes("//")) return false;
  if (n.includes("@{") || n.includes("~") || n.includes("^") || n.includes(":"))
    return false;
  if (n === "HEAD" || n === "@") return false;
  return /^[A-Za-z0-9._/\-]+$/.test(n);
}
