/**
 * Pure helpers for mobile layout detection.
 * Browser hook lives in `hooks/use-mobile-layout.ts`.
 */

export type LayoutPreference = "auto" | "mobile" | "desktop";

export const MOBILE_LAYOUT_STORAGE_KEY = "spok.layoutPreference";
export const MOBILE_BREAKPOINT_PX = 768;

/** Coarse UA check — not perfect, combined with viewport. */
export function looksLikeMobileUserAgent(ua: string): boolean {
  if (!ua) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile/i.test(
    ua
  );
}

export function resolveLayoutPreference(
  raw: string | null | undefined
): LayoutPreference {
  if (raw === "mobile" || raw === "desktop" || raw === "auto") return raw;
  return "auto";
}

/**
 * Decide mobile shell vs desktop shell.
 * Preference overrides auto; auto uses viewport width and optional UA/coarse pointer.
 */
export function shouldUseMobileLayout(opts: {
  preference: LayoutPreference;
  /** Viewport width in CSS px */
  width: number;
  userAgent?: string;
  /** matchMedia('(pointer: coarse)') */
  coarsePointer?: boolean;
}): boolean {
  if (opts.preference === "mobile") return true;
  if (opts.preference === "desktop") return false;

  const narrow = opts.width > 0 && opts.width < MOBILE_BREAKPOINT_PX;
  const uaMobile = looksLikeMobileUserAgent(opts.userAgent ?? "");
  // Phone-like: narrow viewport, or mobile UA with coarse pointer (or just narrow)
  if (narrow) return true;
  if (uaMobile && opts.coarsePointer !== false && opts.width < 1024) return true;
  return false;
}

export function readLayoutPreferenceFromSearch(
  search: string
): LayoutPreference | null {
  try {
    const q = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search
    );
    if (q.get("mobile") === "1" || q.get("layout") === "mobile") return "mobile";
    if (q.get("desktop") === "1" || q.get("layout") === "desktop")
      return "desktop";
    if (q.get("layout") === "auto") return "auto";
  } catch {
    /* ignore */
  }
  return null;
}
