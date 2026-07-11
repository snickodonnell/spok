import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultTaskLaunchTarget,
  parseTaskLaunchTarget,
  sameWorkspace,
  validateTaskLaunch,
} from "../../src/lib/task-launch";

describe("new task launch decisions", () => {
  it("defaults to background only for a task in the active repository", () => {
    assert.equal(
      defaultTaskLaunchTarget({
        cwd: "C:\\dev\\spok\\",
        activeSessionCwd: "c:/dev/spok",
        task: "Fix the failing tests",
      }),
      "background"
    );
    assert.equal(
      defaultTaskLaunchTarget({
        cwd: "/work/spok",
        activeSessionCwd: "/work/other",
        task: "Fix the failing tests",
      }),
      "interactive"
    );
    assert.equal(
      defaultTaskLaunchTarget({
        cwd: "/work/spok",
        activeSessionCwd: "/work/spok",
        task: "   ",
      }),
      "interactive"
    );
  });

  it("normalizes separators, trailing slashes, and case for repo matching", () => {
    assert.equal(sameWorkspace("C:\\DEV\\Spok\\", "c:/dev/spok"), true);
    assert.equal(sameWorkspace("/work/repo/", "/work/repo"), true);
    assert.equal(sameWorkspace("/work/repo", "/work/repository"), false);
    assert.equal(sameWorkspace("", "/work/repo"), false);
  });

  it("requires a task for background work but not interactive work", () => {
    const background = validateTaskLaunch({
      cwd: "/work/repo",
      command: "grok",
      task: "",
      target: "background",
    });
    assert.equal(background.ok, false);
    assert.match(background.errors.task || "", /describe the task/i);

    const interactive = validateTaskLaunch({
      cwd: "/work/repo",
      command: "grok",
      task: "",
      target: "interactive",
    });
    assert.deepEqual(interactive, { ok: true, errors: {} });
  });

  it("validates repository and only requires command for interactive work", () => {
    const interactive = validateTaskLaunch({
      cwd: "",
      command: " ",
      task: "Draft this task",
      target: "interactive",
    });
    assert.equal(interactive.ok, false);
    assert.ok(interactive.errors.cwd);
    assert.ok(interactive.errors.command);

    const background = validateTaskLaunch({
      cwd: "/work/repo",
      command: "",
      task: "Run the maintenance task",
      target: "background",
    });
    assert.deepEqual(background, { ok: true, errors: {} });
  });

  it("accepts only known persisted execution targets", () => {
    assert.equal(parseTaskLaunchTarget("interactive"), "interactive");
    assert.equal(parseTaskLaunchTarget("background"), "background");
    assert.equal(parseTaskLaunchTarget("auto"), null);
    assert.equal(parseTaskLaunchTarget(null), null);
  });
});
