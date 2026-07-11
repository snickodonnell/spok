import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultRightTabForMode,
  isProductMode,
  isWorkspaceRightTab,
  PRODUCT_MODE_META,
  RIGHT_TAB_META,
} from "../../src/lib/product-modes";

describe("product modes", () => {
  it("has four primary modes", () => {
    assert.deepEqual(Object.keys(PRODUCT_MODE_META).sort(), [
      "automate",
      "extend",
      "review",
      "run",
    ]);
  });

  it("maps review mode to review tab", () => {
    assert.equal(defaultRightTabForMode("review"), "review");
    assert.equal(defaultRightTabForMode("run"), "changes");
    assert.equal(defaultRightTabForMode("automate"), "changes");
  });

  it("validates mode and tab guards", () => {
    assert.equal(isProductMode("run"), true);
    assert.equal(isProductMode("nope"), false);
    assert.equal(isWorkspaceRightTab("changes"), true);
    assert.equal(isWorkspaceRightTab("validation"), true);
    assert.equal(isWorkspaceRightTab("diff"), false);
  });

  it("labels right tabs for task orientation", () => {
    assert.equal(RIGHT_TAB_META.changes.label, "Changes");
    assert.equal(RIGHT_TAB_META.review.label, "Review");
    assert.equal(RIGHT_TAB_META.validation.label, "Validation");
    assert.equal(RIGHT_TAB_META.events.label, "Events");
    assert.equal(RIGHT_TAB_META.health.label, "Health");
  });
});
