import { extractSubagentLanes } from "./automation/subagent-lanes";
import type { AutomationJob, SubagentLane } from "./automation/types";
import { collectThoughtBlocks } from "./trace-text";
import type { Session, TraceNode } from "./types";

const GOAL_START = "[SPOK_ENTERPRISE_GOAL]";
const GOAL_END = "[/SPOK_ENTERPRISE_GOAL]";
const CREW_START = "[SPOK_ENTERPRISE_CREW]";
const CREW_END = "[/SPOK_ENTERPRISE_CREW]";
const MAX_CREW = 8;

export type EnterpriseCrewDraft = {
  id: string;
  name: string;
  assignment: string;
};

export type EnterpriseTeamStatus =
  | "queued"
  | "launching"
  | "working"
  | "waiting"
  | "complete"
  | "needs_attention";

export type EnterpriseTeam = {
  id: string;
  goal: string;
  cwd: string;
  createdAt: number;
  jobs: AutomationJob[];
  currentJob: AutomationJob;
  requestedCrew: EnterpriseCrewDraft[];
  status: EnterpriseTeamStatus;
  summary: string;
  acceptedAt?: number;
};

export type EnterpriseCrewStation = {
  id: string;
  name: string;
  assignment: string;
  lane: SubagentLane | null;
  requested: boolean;
  status: "briefed" | "working" | "done" | "error" | "skipped";
};

function clip(value: string | undefined, max: number): string {
  const text = (value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function between(value: string, startMarker: string, endMarker: string): string {
  const start = value.indexOf(startMarker);
  if (start < 0) return "";
  const contentStart = start + startMarker.length;
  const end = value.indexOf(endMarker, contentStart);
  return end < 0 ? "" : value.slice(contentStart, end).trim();
}

function goalBlock(goal: string): string {
  return `${GOAL_START}\n${goal.trim()}\n${GOAL_END}`;
}

function crewBlock(crew: EnterpriseCrewDraft[]): string {
  return `${CREW_START}\n${JSON.stringify(crew)}\n${CREW_END}`;
}

export function extractEnterpriseGoal(prompt: string): string {
  return between(prompt, GOAL_START, GOAL_END);
}

export function extractEnterpriseCrew(prompt: string): EnterpriseCrewDraft[] {
  const raw = between(prompt, CREW_START, CREW_END);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item)
      )
      .map((item) => ({
        id: typeof item.id === "string" ? item.id.trim().slice(0, 128) : "",
        name:
          typeof item.name === "string" ? item.name.trim().slice(0, 80) : "",
        assignment:
          typeof item.assignment === "string"
            ? item.assignment.trim().slice(0, 20_000)
            : "",
      }))
      .filter((item) => item.id && item.name && item.assignment)
      .slice(0, MAX_CREW);
  } catch {
    return [];
  }
}

export function validateEnterpriseDraft(input: {
  goal: string;
  crew: EnterpriseCrewDraft[];
  cwd?: string;
}): { ok: boolean; reason?: string } {
  if (!input.cwd?.trim()) {
    return { ok: false, reason: "Open a repository before launching Enterprise." };
  }
  if (!input.goal.trim()) {
    return { ok: false, reason: "Add the ultimate goal for Spok." };
  }
  const assigned = input.crew.filter(
    (member) => member.name.trim() && member.assignment.trim()
  );
  if (assigned.length === 0) {
    return { ok: false, reason: "Add at least one crew assignment." };
  }
  if (assigned.length > MAX_CREW) {
    return { ok: false, reason: `Enterprise supports up to ${MAX_CREW} crew stations.` };
  }
  const names = new Set<string>();
  for (const member of assigned) {
    const key = member.name.trim().toLowerCase();
    if (names.has(key)) {
      return { ok: false, reason: "Crew names must be unique." };
    }
    names.add(key);
  }
  return { ok: true };
}

export function buildEnterpriseMissionPrompt(input: {
  goal: string;
  crew: EnterpriseCrewDraft[];
}): string {
  const crew = input.crew.filter(
    (member) => member.name.trim() && member.assignment.trim()
  );
  const manifest = crew
    .map(
      (member, index) =>
        `${index + 1}. ${member.name.trim()} — ${member.assignment.trim()}`
    )
    .join("\n");
  return [
    "You are Spok at the helm of an Enterprise engineering mission.",
    goalBlock(input.goal),
    crewBlock(crew),
    "Requested crew assignments:",
    manifest,
    "Coordinate this mission using your native subagent capabilities:",
    "- create and lead subagents for the requested assignments; preserve their names when the provider allows it;",
    "- identify dependencies and exchange only the context each specialist needs;",
    "- keep work inside the isolated worktree Spok provides;",
    "- integrate and review crew results yourself rather than merely listing them;",
    "- validate the smallest useful scope and surface conflicts or policy blocks;",
    "- do not claim a crew member ran unless a real subagent lane exists;",
    "- finish with one substantial team summary covering outcome, contributions, changes, checks, blockers, and safest next actions.",
  ].join("\n\n");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function laneStatus(
  lane: SubagentLane | null
): EnterpriseCrewStation["status"] {
  if (!lane) return "briefed";
  if (lane.status === "running" || lane.status === "pending") return "working";
  if (lane.status === "error") return "error";
  if (lane.status === "skipped") return "skipped";
  return "done";
}

/** Match requested assignments to truthful provider-emitted subagent lanes. */
export function buildEnterpriseCrewStations(
  requested: EnterpriseCrewDraft[],
  lanes: SubagentLane[]
): EnterpriseCrewStation[] {
  const remaining = new Set(lanes.map((lane) => lane.id));
  const stations: EnterpriseCrewStation[] = requested.map((member) => {
    const target = normalize(member.name);
    const lane =
      lanes.find((candidate) => normalize(candidate.label) === target) ??
      lanes.find((candidate) => normalize(candidate.label).includes(target)) ??
      null;
    if (lane) remaining.delete(lane.id);
    return {
      id: member.id,
      name: member.name,
      assignment: member.assignment,
      lane,
      requested: true,
      status: laneStatus(lane),
    };
  });
  for (const lane of lanes) {
    if (!remaining.has(lane.id)) continue;
    stations.push({
      id: `lane-${lane.id}`,
      name: lane.label,
      assignment: lane.summary || "Provider-created supporting mission",
      lane,
      requested: false,
      status: laneStatus(lane),
    });
  }
  return stations;
}

function currentSession(
  job: AutomationJob,
  sessions: Record<string, Session>
): Session | undefined {
  return job.sessionId ? sessions[job.sessionId] : undefined;
}

export function enterpriseSummary(
  job: AutomationJob,
  sessions: Record<string, Session>
): string {
  const session = currentSession(job, sessions);
  if (!session) return "";
  const blocks = collectThoughtBlocks(session.nodes, session.eventLog);
  return blocks.filter((block) => block.kind === "summary").at(-1)?.text ?? "";
}

function statusFor(job: AutomationJob, summary: string): EnterpriseTeamStatus {
  switch (job.status) {
    case "queued":
      return "queued";
    case "starting":
      return "launching";
    case "running":
      return "working";
    case "waiting_approval":
      return "waiting";
    case "completed":
      return summary ? "complete" : "needs_attention";
    default:
      return "needs_attention";
  }
}

export function buildEnterpriseTeams(
  jobs: AutomationJob[],
  sessions: Record<string, Session>
): EnterpriseTeam[] {
  const grouped = new Map<string, AutomationJob[]>();
  for (const job of jobs) {
    if (!job.enterprise) continue;
    const list = grouped.get(job.enterprise.teamId) ?? [];
    list.push(job);
    grouped.set(job.enterprise.teamId, list);
  }
  const teams: EnterpriseTeam[] = [];
  for (const [id, teamJobs] of grouped) {
    const ordered = [...teamJobs].sort(
      (a, b) =>
        (a.enterprise?.turn ?? 1) - (b.enterprise?.turn ?? 1) ||
        a.createdAt - b.createdAt
    );
    const initial =
      ordered.find((job) => job.enterprise?.phase === "mission") ?? ordered[0];
    const currentJob = ordered.at(-1)!;
    const summary = enterpriseSummary(currentJob, sessions);
    teams.push({
      id,
      goal: extractEnterpriseGoal(initial.prompt),
      cwd: initial.mainCheckout ?? initial.cwd,
      createdAt: initial.createdAt,
      jobs: ordered,
      currentJob,
      requestedCrew: extractEnterpriseCrew(initial.prompt),
      status: statusFor(currentJob, summary),
      summary,
      acceptedAt: currentJob.enterprise?.acceptedAt,
    });
  }
  return teams.sort((a, b) => b.createdAt - a.createdAt);
}

export function enterpriseTurn(job: AutomationJob): number {
  return job.enterprise?.turn ?? 1;
}

export function enterpriseLanes(
  job: AutomationJob | null,
  sessions: Record<string, Session>
): SubagentLane[] {
  const session = job ? currentSession(job, sessions) : undefined;
  return session ? extractSubagentLanes(session.nodes) : [];
}

export function enterpriseTraceNodes(
  job: AutomationJob | null,
  sessions: Record<string, Session>,
  lane?: SubagentLane | null,
  limit = 80
): TraceNode[] {
  const session = job ? currentSession(job, sessions) : undefined;
  if (!session) return [];
  const laneIds = lane ? new Set(lane.nodeIds) : null;
  const selectedLaneId = lane?.id;
  const allLaneNodeIds = lane
    ? null
    : new Set(
        extractSubagentLanes(session.nodes).flatMap((candidate) =>
          candidate.nodeIds
        )
      );
  return Object.values(session.nodes)
    .filter((node) => {
      if (node.meta?.backgroundJob === true) return false;
      if (!laneIds) {
        return (
          !allLaneNodeIds?.has(node.id) &&
          !node.subagentId &&
          node.type !== "subagent"
        );
      }
      return laneIds.has(node.id) || node.subagentId === selectedLaneId;
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-Math.max(1, limit));
}

export function buildEnterpriseFollowupPrompt(input: {
  team: EnterpriseTeam;
  followup: string;
  lanes: SubagentLane[];
}): string {
  const laneEvidence = input.lanes.length
    ? input.lanes
        .map(
          (lane) =>
            `${lane.label} [${lane.status}] — ${clip(lane.summary, 800) || "No lane summary"}`
        )
        .join("\n")
    : "No provider-emitted subagent lanes were captured in the previous turn.";
  return [
    "Continue the Enterprise team mission as Spok, using the most recent Grok session in this same isolated worktree.",
    goalBlock(input.team.goal),
    crewBlock(input.team.requestedCrew),
    input.team.summary
      ? `Previous team summary:\n${clip(input.team.summary, 6_000)}`
      : "The prior turn ended without a substantial team summary.",
    `Previous crew evidence:\n${laneEvidence}`,
    `Captain's follow-up:\n${input.followup.trim()}`,
    "Coordinate real subagents again when the request benefits from them. Finish with an updated team summary and distinguish new evidence from prior work.",
  ].join("\n\n");
}

export function enterpriseStatusLabel(status: EnterpriseTeamStatus): string {
  switch (status) {
    case "queued":
      return "Awaiting launch";
    case "launching":
      return "Preparing ship";
    case "working":
      return "Crew underway";
    case "waiting":
      return "Needs approval";
    case "complete":
      return "Summary ready";
    case "needs_attention":
      return "Needs attention";
  }
}
