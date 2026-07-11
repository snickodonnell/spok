import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  readCachedUiPrefs,
  writeCachedUiPrefs,
  UI_PREFS_STORAGE_KEY,
  UI_PREFS_BOOT_SCRIPT,
} from "../../src/lib/ui-prefs-cache";

describe("ui prefs cache", () => {
  const mem = new Map<string, string>();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    mem.clear();
    // Minimal localStorage for node tests
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = originalWindow;
    }
  });

  it("round-trips theme prefs", () => {
    writeCachedUiPrefs({
      theme: "crt",
      crtEnabled: true,
      scanlines: true,
      reducedMotion: false,
      permissionMode: "manual",
    });
    const got = readCachedUiPrefs();
    assert.ok(got);
    assert.equal(got!.theme, "crt");
    assert.equal(got!.crtEnabled, true);
    assert.equal(got!.scanlines, true);
    assert.equal(got!.permissionMode, "manual");
    assert.ok(mem.get(UI_PREFS_STORAGE_KEY));
  });

  it("rejects invalid theme payloads", () => {
    mem.set(UI_PREFS_STORAGE_KEY, JSON.stringify({ theme: "neon" }));
    assert.equal(readCachedUiPrefs(), null);
  });

  it("boot script is self-contained and references the storage key", () => {
    assert.match(UI_PREFS_BOOT_SCRIPT, /localStorage/);
    assert.match(UI_PREFS_BOOT_SCRIPT, new RegExp(UI_PREFS_STORAGE_KEY));
    assert.match(UI_PREFS_BOOT_SCRIPT, /data-theme/);
  });
});
