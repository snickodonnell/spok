import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEnterpriseCrewStations,
  buildEnterpriseFollowupPrompt,
  buildEnterpriseMissionPrompt,
  buildEnterpriseTeams,
  enterpriseLanes,
  enterpriseTraceNodes,
  extractEnterpriseCrew,
  extractEnterpriseGoal,
  validateEnterpriseDraft,
  type EnterpriseCrewDraft,
} from "../../src/lib/enterprise";
import type { AutomationJob } from "../../src/lib/automation/types";
import type { Session, TraceNode } from "../../src/lib/types";

const crew: EnterpriseCrewDraft[] = [
  { id: "nova", name: "Nova", assignment: "Map the runtime contract" },
  { id: "patch", name: "Patch", assignment: "Implement focused tests" },
];

function job(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: "job-enterprise",
    kind: "background",
    title: "Enterprise · Ship it",
    prompt: buildEnterpriseMissionPrompt({
      goal: "Ship the coordinated Enterprise surface",
      crew,
    }),
    cwd: "C:\\repo",
    isolate: true,
    status: "running",
    priority: 20,
    createdAt: 100,
    enterprise: {
      version: 1,
      teamId: "ent-test",
      role: "leader",
      phase: "mission",
      turn: 1,
      memberId: "spok",
      memberName: "Spok",
    },
    ...overrides,
  };
}

function node(overrides: Partial<TraceNode>): TraceNode {
  return {
    id: "node",
    parentId: null,
    type: "thinking",
    title: "Thinking",
    content: "Working through the coordinated mission.",
    timestamp: 100,
    children: [],
    links: [],
    depth: 0,
    ...overrides,
  };
}

function session(nodes: TraceNode[], id = "session-enterprise"): Session {
  return {
    id,
    name: "Enterprise · Spok",
    status: "completed",
    createdAt: 100,
    updatedAt: 200,
    config: {
      cwd: "C:\\repo-spok",
      mainCheckout: "C:\\repo",
      worktreePath: "C:\\repo-spok",
      isolationGuard: true,
      command: "grok",
      args: [],
      autoScroll: true,
      playbackSpeed: 1,
    },
    metrics: {
      startedAt: 100,
      endedAt: 200,
      elapsedMs: 100,
      toolCallCount: 1,
      thinkingSteps: 1,
      filesChanged: 1,
      linesAdded: 4,
      linesDeleted: 1,
      subagentCount: 1,
      errorCount: 0,
    },
    rootTraceIds: nodes.filter((item) => !item.parentId).map((item) => item.id),
    nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
    files: {},
    fileTree: [],
    selectedTraceId: null,
    selectedFileId: null,
    timelineCursor: null,
    rawLog: [],
    source: "live",
    promptHistory: [],
    eventLog: [],
    backgroundJob: true,
  };
}

describe("Enterprise mission contract", () => {
  it("roundtrips the ultimate goal and requested crew through one leader prompt", () => {
    const prompt = buildEnterpriseMissionPrompt({
      goal: "Deliver a polished mission control surface",
      crew,
    });

    assert.equal(
      extractEnterpriseGoal(prompt),
      "Deliver a polished mission control surface"
    );
    assert.deepEqual(extractEnterpriseCrew(prompt), crew);
    assert.match(prompt, /native subagent capabilities/i);
    assert.match(prompt, /do not claim a crew member ran/i);
  });

  it("validates repository, assignments, capacity, and unique names", () => {
    assert.equal(
      validateEnterpriseDraft({ goal: "Goal", crew, cwd: "C:\\repo" }).ok,
      true
    );
    assert.match(
      validateEnterpriseDraft({ goal: "Goal", crew, cwd: "" }).reason ?? "",
      /repository/i
    );
    assert.match(
      validateEnterpriseDraft({
        goal: "Goal",
        cwd: "C:\\repo",
        crew: [crew[0], { ...crew[1], name: "nova" }],
      }).reason ?? "",
      /unique/i
    );
  });

  it("reconstructs a durable team and uses only a substantial Grok summary", () => {
    const summary = node({
      id: "summary",
      type: "message",
      title: "Final",
      content:
        "The Enterprise crew completed the requested surface, validated the focused contracts, and identified the remaining integration review.",
      timestamp: 300,
      status: "success",
    });
    const spokJob = job({
      status: "completed",
      sessionId: "session-enterprise",
      worktreePath: "C:\\repo-spok",
      mainCheckout: "C:\\repo",
      branch: "spok/enterprise",
    });
    const teams = buildEnterpriseTeams([spokJob], {
      "session-enterprise": session([summary]),
    });

    assert.equal(teams.length, 1);
    assert.equal(teams[0].status, "complete");
    assert.match(teams[0].summary, /crew completed/i);
    assert.equal(teams[0].requestedCrew.length, 2);
  });

  it("keeps requested crew distinct from real provider-emitted lanes", () => {
    const subagent = node({
      id: "sub-nova",
      type: "subagent",
      title: "Nova",
      content: "Runtime mapping complete",
      status: "success",
      subagentId: "nova-lane",
    });
    const tool = node({
      id: "tool-nova",
      parentId: "sub-nova",
      type: "tool_call",
      title: "Read runtime",
      content: "",
      status: "success",
      timestamp: 110,
    });
    const sess = session([subagent, tool]);
    const spokJob = job({ sessionId: sess.id });
    const lanes = enterpriseLanes(spokJob, { [sess.id]: sess });
    const stations = buildEnterpriseCrewStations(crew, lanes);

    assert.equal(stations.find((item) => item.name === "Nova")?.status, "done");
    assert.equal(
      stations.find((item) => item.name === "Patch")?.status,
      "briefed"
    );
    assert.equal(
      enterpriseTraceNodes(spokJob, { [sess.id]: sess }, lanes[0]).some(
        (item) => item.id === "tool-nova"
      ),
      true
    );
  });

  it("builds a continuation prompt from the prior summary and lane evidence", () => {
    const completeJob = job({
      status: "completed",
      sessionId: "session-enterprise",
      worktreePath: "C:\\repo-spok",
      mainCheckout: "C:\\repo",
    });
    const summaryNode = node({
      id: "summary",
      type: "message",
      content:
        "The coordinated mission is complete enough for a follow-up review of validation gaps and integration risks.",
      timestamp: 300,
    });
    const team = buildEnterpriseTeams([completeJob], {
      "session-enterprise": session([summaryNode]),
    })[0];
    const prompt = buildEnterpriseFollowupPrompt({
      team,
      followup: "Have the team close the validation gaps.",
      lanes: [],
    });

    assert.match(prompt, /Continue the Enterprise team mission/i);
    assert.match(prompt, /close the validation gaps/i);
    assert.match(prompt, /No provider-emitted subagent lanes/i);
  });

  it("orders durable turns, keeps current summary truth, and restores acceptance", () => {
    const first = job({
      id: "job-turn-1",
      status: "completed",
      sessionId: "session-turn-1",
    });
    const second = job({
      id: "job-turn-2",
      status: "completed",
      createdAt: 200,
      sessionId: "session-turn-2",
      enterprise: {
        version: 1,
        teamId: "ent-test",
        role: "leader",
        phase: "followup",
        turn: 2,
        memberId: "spok",
        memberName: "Spok",
        acceptedAt: 400,
      },
    });
    const teams = buildEnterpriseTeams(
      [second, first],
      {
        "session-turn-1": session(
          [node({ id: "first-summary", type: "message", content: "The first turn completed its initial coordinated mission with durable evidence." })],
          "session-turn-1"
        ),
        "session-turn-2": session(
          [node({ id: "second-summary", type: "message", content: "The follow-up turn closed the remaining review gaps and produced the accepted result." })],
          "session-turn-2"
        ),
      }
    );

    assert.deepEqual(teams[0].jobs.map((item) => item.id), ["job-turn-1", "job-turn-2"]);
    assert.equal(teams[0].currentJob.id, "job-turn-2");
    assert.equal(teams[0].acceptedAt, 400);
    assert.match(teams[0].summary, /follow-up turn/i);
  });
});
