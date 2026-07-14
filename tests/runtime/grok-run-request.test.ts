import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultGrokFlags } from "../../src/lib/grok-commands";
import {
  buildInteractiveGrokRunRequest,
  buildLeafGrokRunRequest,
} from "../../src/lib/runtime/grok-run-request-client";
import { parseGrokRunRequest } from "../../src/lib/runtime/grok-run-request";

describe("managed Grok run request builders", () => {
  it("moves interactive prompt content out of resolved argv", () => {
    const request = buildInteractiveGrokRunRequest({
      id: "interactive-request",
      cwd: process.cwd(),
      prompt: "secret-bearing prompt body",
      flags: defaultGrokFlags(),
      resolvedArgs: ["--max-turns", "4", "-p", "secret-bearing prompt body"],
    });
    assert.equal(request.prompt.text, "secret-bearing prompt body");
    assert.equal(request.execution.maxTurns, 20);
    assert.equal(JSON.stringify(request).includes('"args"'), false);
    assert.deepEqual(request.session, { intent: "new" });
    assert.doesNotThrow(() => parseGrokRunRequest(request));
  });

  it("preserves an exact resume identity and rejects an invalid explicit id", () => {
    const flags = defaultGrokFlags();
    const exact = buildInteractiveGrokRunRequest({
      id: "resume-request",
      cwd: process.cwd(),
      prompt: "Continue the bounded task",
      flags,
      resolvedArgs: ["--resume", "44444444-4444-4444-8444-444444444444"],
    });
    assert.deepEqual(exact.session, {
      intent: "resume",
      sessionId: "44444444-4444-4444-8444-444444444444",
    });
    assert.throws(
      () =>
        buildInteractiveGrokRunRequest({
          id: "bad-resume-request",
          cwd: process.cwd(),
          prompt: "Do not silently resume latest",
          flags,
          resolvedArgs: ["--resume", "not-a-session-id"],
        }),
      /exact UUID/i
    );
  });

  it("builds an exact isolated leaf with bounded authority and no descendants", () => {
    const request = buildLeafGrokRunRequest({
      id: "leaf-request",
      cwd: process.cwd(),
      prompt: "Return a compact specialist report",
      maxTurns: 7,
      output: "report",
    });
    assert.equal(request.role, "leaf");
    assert.equal(request.unattended, true);
    assert.equal(request.workspace.kind, "existing");
    assert.equal(request.workspace.kind === "existing" && request.workspace.isolation, "verified");
    assert.equal(request.execution.maxTurns, 7);
    assert.deepEqual(request.execution.delegation, { mode: "deny" });
    assert.equal(request.session.intent, "new");
    assert.ok(request.session.intent === "new" && request.session.sessionId);
    assert.deepEqual(request.output, { mode: "report", schema: "specialist" });
    assert.doesNotThrow(() => parseGrokRunRequest(request));
  });
});
