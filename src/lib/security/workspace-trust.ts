import { canonicalizePath, isPathInsideRoot } from "./paths";

/**
 * In-process trusted workspace root registry.
 * Roots are re-established when the user opens a repo (server restart clears trust).
 */
const trustedRoots = new Set<string>();

export function listTrustedRoots(): string[] {
  return [...trustedRoots];
}

export function trustWorkspaceRoot(rawPath: string): string {
  const root = canonicalizePath(rawPath);
  trustedRoots.add(root);
  return root;
}

export function clearTrustedRoots(): void {
  trustedRoots.clear();
}

export function isTrustedWorkspacePath(rawPath: string): boolean {
  if (!trustedRoots.size) return false;
  const candidate = canonicalizePath(rawPath);
  for (const root of trustedRoots) {
    if (isPathInsideRoot(candidate, root)) return true;
  }
  return false;
}

export function findTrustedRoot(rawPath: string): string | null {
  const candidate = canonicalizePath(rawPath);
  for (const root of trustedRoots) {
    if (isPathInsideRoot(candidate, root)) return root;
  }
  return null;
}

export type TrustCheckResult =
  | { ok: true; root: string; path: string }
  | { ok: false; path: string; reason: string };

export function requireTrustedCwd(rawCwd: string | null | undefined): TrustCheckResult {
  if (!rawCwd || !rawCwd.trim()) {
    return { ok: false, path: rawCwd ?? "", reason: "Working directory is required" };
  }
  const path = canonicalizePath(rawCwd);
  const root = findTrustedRoot(path);
  if (!root) {
    return {
      ok: false,
      path,
      reason:
        "Working directory is outside trusted workspace roots. Open the repo in Spok to trust it first.",
    };
  }
  return { ok: true, root, path };
}
