import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeMobileUserAgent,
  readLayoutPreferenceFromSearch,
  shouldUseMobileLayout,
} from "../../src/lib/mobile-layout";

describe("mobile layout detection", () => {
  it("detects common mobile UAs", () => {
    assert.equal(
      looksLikeMobileUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
      ),
      true
    );
    assert.equal(
      looksLikeMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
      false
    );
  });

  it("preference mobile/desktop overrides width", () => {
    assert.equal(
      shouldUseMobileLayout({
        preference: "desktop",
        width: 320,
        userAgent: "iPhone",
      }),
      false
    );
    assert.equal(
      shouldUseMobileLayout({
        preference: "mobile",
        width: 1400,
        userAgent: "Windows",
      }),
      true
    );
  });

  it("auto uses narrow viewport", () => {
    assert.equal(
      shouldUseMobileLayout({
        preference: "auto",
        width: 390,
        userAgent: "iPhone",
      }),
      true
    );
    assert.equal(
      shouldUseMobileLayout({
        preference: "auto",
        width: 1440,
        userAgent: "Windows NT",
        coarsePointer: false,
      }),
      false
    );
  });

  it("parses query overrides", () => {
    assert.equal(readLayoutPreferenceFromSearch("?mobile=1"), "mobile");
    assert.equal(readLayoutPreferenceFromSearch("desktop=1"), "desktop");
    assert.equal(readLayoutPreferenceFromSearch("?layout=auto"), "auto");
    assert.equal(readLayoutPreferenceFromSearch(""), null);
  });
});
