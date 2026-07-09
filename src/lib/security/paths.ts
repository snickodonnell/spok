import path from "path";

/** Normalize a repo-relative path for deny-glob matching (forward slashes). Browser-safe. */
export function normalizeRepoRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/**
 * Canonicalize a filesystem path for policy comparisons.
 * Resolves `.` / `..`, normalizes separators, and uppercases drive letters on Windows.
 * Server-only: uses Node `path`.
 */
export function canonicalizePath(input: string): string {
  const resolved = path.resolve(input.trim());
  if (process.platform === "win32") {
    // path.resolve already uses `\`; normalize drive letter case for comparisons
    return resolved.replace(/^([A-Za-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  }
  return resolved;
}

/**
 * True when `candidate` is the same as `root` or a path strictly under it.
 * Both inputs are canonicalized before comparison.
 */
export function isPathInsideRoot(candidate: string, root: string): boolean {
  const c = canonicalizePath(candidate);
  const r = canonicalizePath(root);

  if (process.platform === "win32") {
    const cLower = c.toLowerCase();
    const rLower = r.toLowerCase();
    if (cLower === rLower) return true;
    const prefix = rLower.endsWith("\\") ? rLower : `${rLower}\\`;
    return cLower.startsWith(prefix);
  }

  if (c === r) return true;
  const prefix = r.endsWith("/") ? r : `${r}/`;
  return c.startsWith(prefix);
}
