import { extractSubagentLanes } from "./automation/subagent-lanes";
import type { AutomationJob, SubagentLane } from "./automation/types";
import { collectThoughtBlocks } from "./trace-text";
import {
  toInboxEntry,
  type InboxNextAction,
  type InboxReasonSource,
} from "./session-inbox";
import type { Session, TraceNode } from "./types";

const GOAL_START = "[SPOK_ENTERPRISE_GOAL]";
const GOAL_END = "[/SPOK_ENTERPRISE_GOAL]";
const CREW_START = "[SPOK_ENTERPRISE_CREW]";
const CREW_END = "[/SPOK_ENTERPRISE_CREW]";
export const MAX_ENTERPRISE_AGENTS = 5;
export const MAX_ENTERPRISE_CREW = MAX_ENTERPRISE_AGENTS - 1;

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
  | "ready_review"
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
  statusReason: string;
  statusSource: InboxReasonSource;
  nextAction: InboxNextAction;
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

export type EnterpriseDeckRoom =
  | "bridge"
  | "ready"
  | "science"
  | "mission"
  | "engineering"
  | "review"
  | "comms";

export type EnterpriseDeckActor = {
  id: string;
  name: string;
  room: EnterpriseDeckRoom;
  activity: string;
  eventAt: number;
};

export type EnterpriseCoordination = {
  id: string;
  from: string;
  to: string;
  label: string;
  eventAt: number;
  tone: "task" | "message" | "report" | "blocked";
};

export type EnterpriseDeckState = {
  actors: EnterpriseDeckActor[];
  coordination: EnterpriseCoordination[];
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
      .slice(0, MAX_ENTERPRISE_CREW);
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
    return { ok: false, reason: "Open a repository before launching a mission." };
  }
  if (!input.goal.trim()) {
    return { ok: false, reason: "Add the ultimate goal for Spok." };
  }
  const assigned = input.crew.filter(
    (member) => member.name.trim() && member.assignment.trim()
  );
  if (assigned.length > MAX_ENTERPRISE_CREW) {
    return {
      ok: false,
      reason: `Enterprise supports ${MAX_ENTERPRISE_AGENTS} agents total: Spok and up to ${MAX_ENTERPRISE_CREW} crew.`,
    };
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
  const manifest = crew.length
    ? crew
        .map(
          (member, index) =>
            `${index + 1}. ${member.name.trim()} — ${member.assignment.trim()}`
        )
        .join("\n")
    : "No specialists are preset. Design the smallest useful team from the goal.";
  return [
    "You are Spok, the accountable leader of a long-running Grok engineering mission.",
    goalBlock(input.goal),
    crewBlock(crew),
    "Optional specialist suggestions:",
    manifest,
    "Before delegating, read and follow the repository AGENTS.md and the canonical .agents/skills/spok-agent-orchestration/SKILL.md and .agents/skills/spok-grok-cli-operations/SKILL.md when present. Load only the references they route to; do not paste the skill bodies or repository history into agent prompts.",
    "Lead this mission using your native subagent capabilities:",
    "- restate the outcome, constraints, definition of done, risks, and the next meaningful checkpoint before delegating;",
    "- create bounded work items, identify dependencies, and parallelize only independent work;",
    "- create and lead real subagents for useful specialist assignments; preserve suggested names when the provider allows it;",
    `- keep the active team to at most ${MAX_ENTERPRISE_CREW} subagents and prefer the smallest effective team;`,
    "- reserve at least 25% of the available turn/context budget for your integration, validation, and one bounded recovery; do not allocate that reserve to initial specialists;",
    "- give each agent one compact receipt with owned and excluded scope, dependencies, verified cwd/worktree, authority, maximum turns, exact checks, expected evidence, and a clear return condition;",
    "- keep specialists as leaf agents: they must not create subagents unless you issue a separate visible, budgeted work item;",
    "- reference paths, symbols, decisions, and artifacts instead of replaying the mission transcript; require compact reports rather than raw chatter;",
    "- keep work inside the isolated worktree Spok provides;",
    "- supervise blockers and failed work; retry at most once by default with a narrower observed failure, and never broaden authority;",
    "- integrate and review agent results yourself rather than merely listing them;",
    "- validate the smallest useful scope and surface conflicts or policy blocks;",
    "- do not claim an agent ran unless a real provider-emitted subagent lane exists;",
    "- do not equate process exit or an agent report with review readiness;",
    "- finish with a durable checkpoint summary covering completed work, active or blocked work, agent contributions, changes, checks, evidence gaps, risks, and the safest next action.",
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

function assignmentRoom(assignment: string): EnterpriseDeckRoom {
  const value = normalize(assignment);
  if (/\b(test|tests|review|verify|validation|quality|qa|audit)\b/.test(value)) {
    return "review";
  }
  if (/\b(research|explore|investigate|map|docs|document|analyze|analysis)\b/.test(value)) {
    return "science";
  }
  if (/\b(implement|code|fix|build|refactor|runtime|server|api|database|ui|css)\b/.test(value)) {
    return "engineering";
  }
  return "mission";
}

function latestLaneNode(
  station: EnterpriseCrewStation,
  nodes: Record<string, TraceNode>
): TraceNode | null {
  if (!station.lane) return null;
  const laneIds = new Set(station.lane.nodeIds);
  return (
    Object.values(nodes)
      .filter(
        (node) =>
          laneIds.has(node.id) || node.subagentId === station.lane?.id
      )
      .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null
  );
}

/**
 * Materialize truthful ship positions from provider-emitted lane activity.
 * Room changes are deliberate: task work stays at its assigned station, while
 * explicit messages, starts, reports, and failures move crew through Comms.
 */
export function buildEnterpriseDeckState(
  stations: EnterpriseCrewStation[],
  nodes: Record<string, TraceNode>
): EnterpriseDeckState {
  const actors: EnterpriseDeckActor[] = [];
  const coordination: EnterpriseCoordination[] = [];

  for (const station of stations.slice(0, MAX_ENTERPRISE_CREW)) {
    const latest = latestLaneNode(station, nodes);
    const eventAt = latest?.timestamp ?? station.lane?.startedAt ?? 0;
    let room: EnterpriseDeckRoom = assignmentRoom(station.assignment);
    let activity = "Briefed at task station · awaiting lane";

    if (station.status === "working") {
      const isExchange = latest?.type === "message";
      const isTaskBrief = latest?.type === "subagent";
      room = isExchange
        ? "comms"
        : isTaskBrief
          ? "ready"
          : assignmentRoom(station.assignment);
      activity = isExchange
        ? "Exchanging context with Spok"
        : isTaskBrief
          ? "Receiving task brief"
          : "Working assigned task";
      coordination.push({
        id: `${station.id}-${eventAt}-working`,
        from: isExchange ? station.name : "Spok",
        to: isExchange ? "Spok" : station.name,
        label: isExchange
          ? "context message"
          : isTaskBrief
            ? "task brief"
            : "task in progress",
        eventAt,
        tone: isExchange ? "message" : "task",
      });
    } else if (station.status === "done") {
      room = "review";
      activity = "Reporting completed task";
      coordination.push({
        id: `${station.id}-${eventAt}-done`,
        from: station.name,
        to: "Spok",
        label: "task report",
        eventAt,
        tone: "report",
      });
    } else if (station.status === "error") {
      room = "comms";
      activity = "Escalating a blocker";
      coordination.push({
        id: `${station.id}-${eventAt}-error`,
        from: station.name,
        to: "Spok",
        label: "blocker",
        eventAt,
        tone: "blocked",
      });
    } else if (station.status === "skipped") {
      room = "ready";
      activity = "Task lane skipped";
    } else if (station.lane) {
      room = "ready";
      activity = "Receiving task brief";
      coordination.push({
        id: `${station.id}-${eventAt}-brief`,
        from: "Spok",
        to: station.name,
        label: "task brief",
        eventAt,
        tone: "task",
      });
    }

    actors.push({ id: station.id, name: station.name, room, activity, eventAt });
  }

  return {
    actors,
    coordination: coordination
      .sort((a, b) => b.eventAt - a.eventAt)
      .slice(0, MAX_ENTERPRISE_CREW),
  };
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

type EnterpriseLifecycleProjection = {
  status: EnterpriseTeamStatus;
  reason: string;
  source: InboxReasonSource;
  nextAction: InboxNextAction;
};

function statusFor(
  job: AutomationJob,
  summary: string,
  session?: Session
): EnterpriseLifecycleProjection {
  if (session) {
    const entry = toInboxEntry(session, job);
    const status: EnterpriseTeamStatus =
      entry.lane === "running"
        ? "working"
        : entry.lane === "queued"
          ? "queued"
          : entry.lane === "ready_review"
            ? "ready_review"
            : entry.lane === "finished" || entry.lane === "idle"
              ? summary
                ? "complete"
                : "needs_attention"
              : entry.lane === "waiting" && entry.reasonSource === "approval"
                ? "waiting"
                : "needs_attention";
    return {
      status,
      reason: entry.reason,
      source: entry.reasonSource,
      nextAction: entry.nextAction,
    };
  }

  switch (job.status) {
    case "queued":
      return {
        status: "queued",
        reason: "Background job queued",
        source: "job",
        nextAction: { kind: "open_job", label: "View job" },
      };
    case "starting":
      return {
        status: "launching",
        reason: "Preparing isolated workspace",
        source: "job",
        nextAction: { kind: "open_job", label: "View job" },
      };
    case "running":
      return {
        status: "working",
        reason: "Spok leader run active",
        source: "job",
        nextAction: { kind: "open_job", label: "Monitor" },
      };
    case "waiting_approval":
      return {
        status: "waiting",
        reason: "Waiting for approval",
        source: "approval",
        nextAction: { kind: "open_job", label: "Review approval" },
      };
    case "completed":
      return summary
        ? {
            status: "complete",
            reason: "Leader checkpoint ready",
            source: "review",
            nextAction: { kind: "open_job", label: "Review outcome" },
          }
        : {
            status: "needs_attention",
            reason: "Job completed without a leader checkpoint",
            source: "diagnostic",
            nextAction: { kind: "open_job", label: "Inspect state" },
          };
    default:
      return {
        status: "needs_attention",
        reason: job.error?.trim() || `Job ${job.status.replace(/_/g, " ")}`,
        source: job.status === "failed" ? "job" : "diagnostic",
        nextAction: { kind: "open_job", label: "Inspect state" },
      };
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
    const lifecycle = statusFor(
      currentJob,
      summary,
      currentSession(currentJob, sessions)
    );
    teams.push({
      id,
      goal: extractEnterpriseGoal(initial.prompt),
      cwd: initial.mainCheckout ?? initial.cwd,
      createdAt: initial.createdAt,
      jobs: ordered,
      currentJob,
      requestedCrew: extractEnterpriseCrew(initial.prompt),
      status: lifecycle.status,
      statusReason: lifecycle.reason,
      statusSource: lifecycle.source,
      nextAction: lifecycle.nextAction,
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
            `${lane.label} [${lane.status}] — ${clip(lane.summary, 400) || "No lane summary"}`
        )
        .join("\n")
    : "No provider-emitted subagent lanes were captured in the previous turn.";
  return [
    "Continue the Spok-led Grok mission using the most recent session in this same isolated worktree.",
    goalBlock(input.team.goal),
    crewBlock(input.team.requestedCrew),
    input.team.summary
      ? `Previous team summary:\n${clip(input.team.summary, 3_000)}`
      : "The prior turn ended without a substantial team summary.",
    `Previous crew evidence:\n${laneEvidence}`,
    `Captain's follow-up:\n${input.followup.trim()}`,
    "Re-plan dependencies before delegating. Preserve at least 25% of this turn for integration/validation. Coordinate real leaf subagents only when the request benefits from them, send checkpoint deltas rather than the prior transcript, and retry at most once with a narrower observed failure. Finish with an updated durable checkpoint that distinguishes new evidence from prior work and names the safest next action.",
  ].join("\n\n");
}

export function enterpriseStatusLabel(status: EnterpriseTeamStatus): string {
  switch (status) {
    case "queued":
      return "Awaiting launch";
    case "launching":
      return "Preparing workspace";
    case "working":
      return "Spok leading";
    case "waiting":
      return "Needs approval";
    case "ready_review":
      return "Ready for review";
    case "complete":
      return "Checkpoint ready";
    case "needs_attention":
      return "Needs attention";
  }
}
