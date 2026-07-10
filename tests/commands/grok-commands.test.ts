import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultGrokFlags,
  permissionModeLabel,
  resolveRun,
} from "../../src/lib/grok-commands";

describe("grok command defaults", () => {
  it("defaults alwaysApprove to false (safe mode)", () => {
    const flags = defaultGrokFlags();
    assert.equal(flags.alwaysApprove, false);
    assert.equal(permissionModeLabel(flags), "manual");
    assert.equal(
      permissionModeLabel({ ...flags, alwaysApprove: true }),
      "Always approve"
    );
  });

  it("does not emit --always-approve unless enabled", () => {
    const safe = resolveRun("fix the tests", defaultGrokFlags());
    assert.equal(safe.type, "prompt");
    if (safe.type === "prompt") {
      assert.ok(!safe.args.includes("--always-approve"));
      assert.ok(safe.args.includes("-p"));
      assert.equal(safe.args[safe.args.indexOf("-p") + 1], "fix the tests");
    }

    const yolo = resolveRun("fix the tests", {
      ...defaultGrokFlags(),
      alwaysApprove: true,
    });
    assert.equal(yolo.type, "prompt");
    if (yolo.type === "prompt") {
      assert.ok(yolo.args.includes("--always-approve"));
    }
  });

  it("preserves multi-word prompts as a single argv value", () => {
    const prompt = "Audit this repo and create a plan.md";
    const run = resolveRun(prompt, defaultGrokFlags());
    assert.equal(run.type, "prompt");
    if (run.type === "prompt") {
      const pIdx = run.args.indexOf("-p");
      assert.ok(pIdx >= 0);
      assert.equal(run.args[pIdx + 1], prompt);
      // ensure the prompt was not split across argv
      assert.equal(run.args.filter((a) => a === "Audit").length, 0);
    }
  });
});
