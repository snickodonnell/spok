import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDifferentWorkspace,
  normalizeWorkspacePath,
} from "../../src/lib/session-lifecycle-client";

describe("session lifecycle paths", () => {
  it("normalizes Windows and trailing slashes", () => {
    assert.equal(
      normalizeWorkspacePath("C:\\dev\\spok\\"),
      normalizeWorkspacePath("c:/dev/spok")
    );
    assert.equal(
      normalizeWorkspacePath("/home/me/proj/"),
      normalizeWorkspacePath("/home/me/proj")
    );
  });

  it("detects directory change", () => {
    assert.equal(
      isDifferentWorkspace("C:\\dev\\a", "C:\\dev\\b"),
      true
    );
    assert.equal(
      isDifferentWorkspace("C:\\dev\\a\\", "c:/dev/a"),
      false
    );
    assert.equal(isDifferentWorkspace(undefined, "C:\\dev\\a"), true);
    assert.equal(isDifferentWorkspace("C:\\dev\\a", ""), true);
  });
});
