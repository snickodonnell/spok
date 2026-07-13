import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTrustedWorkspaceReceipt } from "../../src/lib/workspace-trust-receipt";

describe("workspace trust receipt", () => {
  it("finds the narrowest trusted root containing the selected repository", () => {
    const receipt = findTrustedWorkspaceReceipt("C:\\dev\\spok\\packages\\web", [
      { path: "C:\\dev", trustedAt: 1 },
      { path: "C:\\dev\\spok", trustedAt: 2 },
    ]);
    assert.equal(receipt?.path, "C:\\dev\\spok");
    assert.equal(receipt?.trustedAt, 2);
  });

  it("does not treat a sibling prefix as trusted", () => {
    assert.equal(
      findTrustedWorkspaceReceipt("C:\\dev\\spokes", [
        { path: "C:\\dev\\spok", trustedAt: 1 },
      ]),
      null
    );
  });
});
