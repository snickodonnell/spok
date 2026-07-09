/**
 * Spok appearance themes (Phase 6).
 * Tokens are applied via `data-theme` on <html>; CRT effects are opt-in overlays.
 */

export type UiTheme = "professional" | "crt" | "high-contrast";

export const UI_THEMES: UiTheme[] = ["professional", "crt", "high-contrast"];

export const THEME_META: Record<
  UiTheme,
  { label: string; description: string; defaultCrt: boolean; defaultScanlines: boolean }
> = {
  professional: {
    label: "Professional",
    description:
      "Quiet dark UI for daily use — clear contrast, restrained color, no phosphor glow.",
    defaultCrt: false,
    defaultScanlines: false,
  },
  crt: {
    label: "CRT phosphor",
    description:
      "Retro green phosphor aesthetic with optional scanlines and glow.",
    defaultCrt: true,
    defaultScanlines: true,
  },
  "high-contrast": {
    label: "High contrast",
    description:
      "Maximum contrast for accessibility — bright text, solid borders, no glow.",
    defaultCrt: false,
    defaultScanlines: false,
  },
};

export function isUiTheme(v: unknown): v is UiTheme {
  return v === "professional" || v === "crt" || v === "high-contrast";
}

/** Resolve CRT effect flags consistently from theme + explicit prefs. */
export function resolveThemeEffects(ui: {
  theme: UiTheme;
  crtEnabled?: boolean;
  scanlines?: boolean;
  reducedMotion?: boolean;
}): {
  theme: UiTheme;
  crtEffects: boolean;
  scanlines: boolean;
  reducedMotion: boolean;
} {
  const theme = ui.theme;
  const meta = THEME_META[theme];
  const reducedMotion = ui.reducedMotion === true;
  // CRT visual effects only on the crt theme, and never when reduced motion is on.
  const crtEffects =
    theme === "crt" && !reducedMotion && (ui.crtEnabled ?? meta.defaultCrt);
  const scanlines =
    crtEffects && !reducedMotion && (ui.scanlines ?? meta.defaultScanlines);
  return { theme, crtEffects, scanlines, reducedMotion };
}

/** Apply theme attributes to the document element (client only). */
export function applyThemeToDocument(opts: {
  theme: UiTheme;
  crtEffects: boolean;
  scanlines: boolean;
  reducedMotion: boolean;
}): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", opts.theme);
  root.classList.toggle("theme-crt-effects", opts.crtEffects);
  root.classList.toggle("theme-scanlines", opts.scanlines);
  root.classList.toggle("reduce-motion", opts.reducedMotion);
  // Keep legacy dark class for Tailwind
  root.classList.add("dark");
}
