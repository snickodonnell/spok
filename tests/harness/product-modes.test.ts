import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultRightTabForMode,
  isProductMode,
  isWorkspaceRightTab,
  missionDisplayName,
  PRODUCT_MODE_META,
  RIGHT_TAB_META,
} from "../../src/lib/product-modes";

describe("product modes", () => {
  it("keeps the Enterprise migration key but presents Missions as the core", () => {
    assert.deepEqual(Object.keys(PRODUCT_MODE_META).sort(), [
      "automate",
      "enterprise",
      "extend",
      "review",
      "run",
    ]);
    assert.equal(PRODUCT_MODE_META.enterprise.label, "Missions");
    assert.match(PRODUCT_MODE_META.enterprise.description, /Spok leads/i);
  });

  it("maps review mode to review tab", () => {
    assert.equal(defaultRightTabForMode("review"), "review");
    assert.equal(defaultRightTabForMode("run"), "changes");
    assert.equal(defaultRightTabForMode("automate"), "changes");
    assert.equal(defaultRightTabForMode("enterprise"), "changes");
  });

  it("validates mode and tab guards", () => {
    assert.equal(isProductMode("run"), true);
    assert.equal(isProductMode("enterprise"), true);
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

  it("presents durable Enterprise-era names as Missions", () => {
    assert.equal(missionDisplayName("Enterprise · Spok"), "Mission · Spok");
    assert.equal(
      missionDisplayName("Enterprise follow-up · Repair validation"),
      "Mission follow-up · Repair validation"
    );
  });
});
