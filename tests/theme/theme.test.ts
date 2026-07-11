import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUiTheme,
  resolveThemeEffects,
  THEME_META,
  UI_THEMES,
} from "../../src/lib/theme";
import { defaultSettings } from "../../src/lib/settings/defaults";
import {
  mergeLayeredSettings,
  sanitizePartialSettings,
} from "../../src/lib/settings/merge";

describe("theme", () => {
  it("exposes three themes with metadata", () => {
    assert.deepEqual(UI_THEMES, ["professional", "crt", "high-contrast"]);
    for (const t of UI_THEMES) {
      assert.ok(THEME_META[t].label);
      assert.ok(THEME_META[t].description);
    }
  });

  it("guards theme values", () => {
    assert.equal(isUiTheme("professional"), true);
    assert.equal(isUiTheme("crt"), true);
    assert.equal(isUiTheme("nope"), false);
  });

  it("disables CRT effects outside crt theme", () => {
    const fx = resolveThemeEffects({
      theme: "professional",
      crtEnabled: true,
      scanlines: true,
    });
    assert.equal(fx.crtEffects, false);
    assert.equal(fx.scanlines, false);
  });

  it("enables CRT effects on crt theme", () => {
    const fx = resolveThemeEffects({
      theme: "crt",
      crtEnabled: true,
      scanlines: true,
    });
    assert.equal(fx.crtEffects, true);
    assert.equal(fx.scanlines, true);
  });

  it("reduced motion kills CRT overlays", () => {
    const fx = resolveThemeEffects({
      theme: "crt",
      crtEnabled: true,
      scanlines: true,
      reducedMotion: true,
    });
    assert.equal(fx.crtEffects, false);
    assert.equal(fx.scanlines, false);
    assert.equal(fx.reducedMotion, true);
  });
});

describe("settings ui merge", () => {
  it("defaults to professional theme", () => {
    const d = defaultSettings();
    assert.equal(d.ui.theme, "professional");
    assert.equal(d.ui.crtEnabled, false);
    assert.equal(d.desktop.nativeFolderPicker, true);
  });

  it("infers crt theme from legacy crtEnabled-only settings", () => {
    const partial = sanitizePartialSettings({
      version: 1,
      ui: { crtEnabled: true, scanlines: true },
    });
    assert.equal(partial.ui?.theme, "crt");
    assert.equal(partial.ui?.crtEnabled, true);
  });

  it("merges ui and desktop layers", () => {
    const bundle = mergeLayeredSettings({
      user: {
        ui: {
          theme: "high-contrast",
          crtEnabled: false,
          scanlines: false,
          reducedMotion: true,
          osNotifications: false,
          contextLimitTokens: 128_000,
          showUsageMeter: true,
        },
        desktop: { nativeFolderPicker: false, osNotifications: false },
      },
    });
    assert.equal(bundle.resolved.ui.theme, "high-contrast");
    assert.equal(bundle.resolved.ui.reducedMotion, true);
    assert.equal(bundle.resolved.desktop.nativeFolderPicker, false);
  });

  it("sanitizes and merges the global background concurrency limit", () => {
    assert.equal(
      sanitizePartialSettings({ maxConcurrentBackground: 99 })
        .maxConcurrentBackground,
      8
    );
    assert.equal(
      mergeLayeredSettings({ user: { maxConcurrentBackground: 4 } }).resolved
        .maxConcurrentBackground,
      4
    );
  });
});
