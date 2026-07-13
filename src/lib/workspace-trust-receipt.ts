import type { TrustedRootDto } from "./local-api-client";

function normalize(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Find the narrowest existing trusted root that contains a selected path. */
export function findTrustedWorkspaceReceipt(
  selectedPath: string,
  roots: TrustedRootDto[]
): TrustedRootDto | null {
  const selected = normalize(selectedPath);
  if (!selected) return null;
  return (
    roots
      .filter((root) => {
        const candidate = normalize(root.path);
        return selected === candidate || selected.startsWith(`${candidate}/`);
      })
      .sort((a, b) => normalize(b.path).length - normalize(a.path).length)[0] ?? null
  );
}
