import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySpecialistReportTerminalState,
  parseSpecialistReport,
  specialistReportToEvent,
} from "../../src/lib/runtime/specialist-report";
import { parseStreamEvent } from "../../src/lib/stream-event-schema";

function validReport(outcome: "completed" | "partial" = "completed") {
  return {
    version: 1 as const,
    outcome,
    summary: "Implemented the bounded provider adapter.",
    changed_paths: ["src/lib/provider.ts"],
    checks: [{ command: "npm test", result: "passed" as const, evidence: "test:408" }],
    artifacts: ["artifact://report/1"],
    risks: outcome === "partial" ? ["One optional integration remains"] : [],
    next_action: outcome === "partial" ? "Integrate the remaining caller" : "Verify the diff",
  };
}

describe("specialist report contract", () => {
  it("accepts a complete report and materializes evidence without advancing lifecycle", () => {
    const result = parseSpecialistReport(JSON.stringify(validReport()));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.completeness, "complete");
    const event = specialistReportToEvent({
      result,
      runId: "run-1",
      workItemId: "wi-1",
      agentRunId: "lane-1",
    });
    assert.equal(event.type, "agent_report");
    assert.equal(event.meta?.evidenceOnly, true);
    assert.equal(parseStreamEvent(event).ok, true);
  });

  it("accepts partial outcome without pretending it is verified", () => {
    const result = parseSpecialistReport(validReport("partial"));
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail("expected report");
    assert.equal(result.completeness, "partial");
    assert.equal(result.report.outcome, "partial");
    assert.equal(specialistReportToEvent({ result }).status, "pending");
  });

  it("returns one format-only repair packet for malformed output", () => {
    const result = parseSpecialistReport("```json\n{}\n```");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected malformed report");
    assert.equal(result.category, "malformed_report");
    assert.equal(result.repair.maxTurns, 1);
    assert.equal(result.repair.includeRepositoryContext, false);
    assert.match(result.repair.prompt, /return only one json object/i);
    const event = specialistReportToEvent({ result, workItemId: "wi-1" });
    assert.equal(event.type, "parser_error");
    assert.equal(event.meta?.category, "malformed_report");
  });

  it("redacts secrets in a structurally valid report", () => {
    const report = validReport();
    report.summary = "Used Bearer sk-not-a-real-secret-value during validation";
    const result = parseSpecialistReport(report);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!JSON.stringify(result.report).includes("sk-not-a-real-secret-value"));
  });

  it("does not treat exit zero as completion for malformed or partial reports", () => {
    const malformed = parseSpecialistReport("not-json");
    const partial = parseSpecialistReport(validReport("partial"));
    const complete = parseSpecialistReport(validReport("completed"));
    assert.equal(classifySpecialistReportTerminalState(0, malformed), "malformed");
    assert.equal(classifySpecialistReportTerminalState(0, partial), "partial");
    assert.equal(classifySpecialistReportTerminalState(0, complete), "completed");
    assert.equal(classifySpecialistReportTerminalState(1, complete), "failed");
  });
});
