"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  GitBranch,
  HardDrive,
  History,
  Loader2,
  MessageSquareText,
  Plus,
  Radio,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TraceNodeIcon } from "@/components/trace/trace-node-icon";
import {
  buildEnterpriseCrewStations,
  buildEnterpriseFollowupPrompt,
  buildEnterpriseMissionPrompt,
  buildEnterpriseTeams,
  enterpriseLanes,
  enterpriseStatusLabel,
  enterpriseTraceNodes,
  enterpriseTurn,
  validateEnterpriseDraft,
  type EnterpriseCrewDraft,
  type EnterpriseCrewStation,
  type EnterpriseTeam,
} from "@/lib/enterprise";
import {
  acceptEnterpriseTurn,
  cancelBackgroundJob,
  enqueueBackgroundJob,
} from "@/lib/background-runner";
import { performInboxJobAction } from "@/lib/inbox-actions";
import { useSpokStore } from "@/lib/store";
import type { AutomationJob } from "@/lib/automation/types";
import type { Session, TraceNode } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

const ACTIVE_JOB_STATUSES = new Set<AutomationJob["status"]>([
  "queued",
  "starting",
  "running",
  "waiting_approval",
]);

const CREW_ART = [
  `  o\n /|\\\n / \\`,
  ` \\o/\n  |\n / \\`,
  `  O>\n /|\\\n / \\`,
  ` _o_\n  |\n / \\`,
] as const;

const CREW_GLYPHS = ["o/", "\\o", "O>", "^o"] as const;

function newCrewMember(index = 0): EnterpriseCrewDraft {
  const names = ["Nova", "Patch", "Scout", "Pixel", "Orbit", "Quill"];
  return {
    id: `crew-${nanoid(7)}`,
    name: names[index % names.length],
    assignment: "",
  };
}

function teamTitle(goal: string): string {
  const first = goal.trim().split(/\r?\n/, 1)[0] || "Enterprise mission";
  return first.length > 54 ? `${first.slice(0, 53)}…` : first;
}

function statusVariant(status: EnterpriseTeam["status"]) {
  if (status === "complete") return "success" as const;
  if (status === "needs_attention") return "error" as const;
  if (status === "waiting") return "amber" as const;
  if (status === "working" || status === "launching") return "cyan" as const;
  return "muted" as const;
}

function stationStatusLabel(station: EnterpriseCrewStation): string {
  switch (station.status) {
    case "briefed":
      return "Briefed · awaiting provider lane";
    case "working":
      return "Working";
    case "done":
      return "Reported";
    case "error":
      return "Error";
    case "skipped":
      return "Skipped";
  }
}

export function EnterpriseScreen() {
  const jobs = useSpokStore((state) => state.automationJobs);
  const activeSessionId = useSpokStore((state) => state.activeSessionId);
  const workspaceCwd = useSpokStore((state) => {
    const session = state.activeSessionId
      ? state.sessions[state.activeSessionId]
      : null;
    return session?.config.mainCheckout || session?.config.cwd || "";
  });
  const setLaunchOpen = useSpokStore((state) => state.setLaunchOpen);
  const setProductMode = useSpokStore((state) => state.setProductMode);
  const setActiveSession = useSpokStore((state) => state.setActiveSession);
  const setViewMode = useSpokStore((state) => state.setViewMode);

  const baseTeams = useMemo(() => buildEnterpriseTeams(jobs, {}), [jobs]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [selectedTurnJobId, setSelectedTurnJobId] = useState<string | null>(null);
  const selectedTeamId = activeTeamId ?? baseTeams[0]?.id ?? null;
  const selectedBaseTeam =
    baseTeams.find((candidate) => candidate.id === selectedTeamId) ?? null;
  const currentSessionId = selectedBaseTeam?.currentJob.sessionId ?? null;
  const inspectedBaseJob =
    selectedBaseTeam?.jobs.find((job) => job.id === selectedTurnJobId) ??
    selectedBaseTeam?.currentJob ??
    null;
  const inspectedSessionId = inspectedBaseJob?.sessionId ?? null;
  const currentSession = useSpokStore((state) =>
    currentSessionId ? state.sessions[currentSessionId] ?? null : null
  );
  const inspectedSession = useSpokStore((state) =>
    inspectedSessionId ? state.sessions[inspectedSessionId] ?? null : null
  );
  const selectedSessions = useMemo<Record<string, Session>>(
    () => {
      const result: Record<string, Session> = {};
      if (currentSessionId && currentSession) result[currentSessionId] = currentSession;
      if (inspectedSessionId && inspectedSession) {
        result[inspectedSessionId] = inspectedSession;
      }
      return result;
    },
    [currentSession, currentSessionId, inspectedSession, inspectedSessionId]
  );
  const teams = useMemo(
    () => buildEnterpriseTeams(jobs, selectedSessions),
    [jobs, selectedSessions]
  );
  const team = teams.find((candidate) => candidate.id === selectedTeamId) ?? null;
  const selectedJob =
    team?.jobs.find((job) => job.id === selectedTurnJobId) ??
    team?.currentJob ??
    null;
  const selectedSession = selectedJob?.sessionId
    ? selectedSessions[selectedJob.sessionId] ?? null
    : null;

  const [draftMode, setDraftMode] = useState(false);
  const [goal, setGoal] = useState("");
  const [crew, setCrew] = useState<EnterpriseCrewDraft[]>([newCrewMember()]);
  const [submitted, setSubmitted] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("spok");
  const [followup, setFollowup] = useState("");

  const lanes = useMemo(
    () => (selectedJob ? enterpriseLanes(selectedJob, selectedSessions) : []),
    [selectedJob, selectedSessions]
  );
  const currentLanes = useMemo(
    () => (team ? enterpriseLanes(team.currentJob, selectedSessions) : []),
    [team, selectedSessions]
  );
  const stations = useMemo(
    () =>
      team
        ? buildEnterpriseCrewStations(team.requestedCrew, lanes)
        : [],
    [team, lanes]
  );
  const selectedStation =
    selectedPersonId === "spok"
      ? null
      : stations.find((station) => station.id === selectedPersonId) ?? null;
  const traceNodes = useMemo(
    () =>
      team
        ? enterpriseTraceNodes(
            selectedJob,
            selectedSessions,
            selectedStation?.lane
          )
        : [],
    [team, selectedJob, selectedSessions, selectedStation]
  );

  useEffect(() => {
    setSelectedPersonId("spok");
    setSelectedTurnJobId(null);
    setFollowup("");
  }, [selectedTeamId]);

  const validation = validateEnterpriseDraft({ goal, crew, cwd: workspaceCwd });

  const updateCrew = (
    id: string,
    patch: Partial<Pick<EnterpriseCrewDraft, "name" | "assignment">>
  ) => {
    setCrew((members) =>
      members.map((member) =>
        member.id === id ? { ...member, ...patch } : member
      )
    );
    setSubmitted(false);
  };

  const launchMission = () => {
    setSubmitted(true);
    if (!validation.ok) {
      toast.error(validation.reason || "Enterprise mission is incomplete");
      return;
    }
    const assignedCrew = crew.filter(
      (member) => member.name.trim() && member.assignment.trim()
    );
    const teamId = `ent-${nanoid(10)}`;
    enqueueBackgroundJob({
      title: `Enterprise · ${teamTitle(goal)}`,
      prompt: buildEnterpriseMissionPrompt({ goal, crew: assignedCrew }),
      cwd: workspaceCwd,
      isolate: true,
      priority: 20,
      parentSessionId: activeSessionId ?? undefined,
      enterprise: {
        version: 1,
        teamId,
        role: "leader",
        phase: "mission",
        turn: 1,
        memberId: "spok",
        memberName: "Spok",
      },
    });
    setActiveTeamId(teamId);
    setDraftMode(false);
    setSelectedPersonId("spok");
    toast.success("Enterprise mission queued", {
      description:
        "Spok will coordinate real Grok subagents inside an isolated worktree.",
    });
  };

  const followUpWithTeam = () => {
    if (!team || !followup.trim()) return;
    const prior = team.currentJob;
    if (!prior.worktreePath || !prior.mainCheckout) {
      toast.error("The managed Enterprise worktree is unavailable", {
        description: "Open the full session or retry the mission safely.",
      });
      return;
    }
    enqueueBackgroundJob({
      title: `Enterprise follow-up · ${teamTitle(followup)}`,
      prompt: buildEnterpriseFollowupPrompt({
        team,
        followup,
        lanes: currentLanes,
      }),
      cwd: prior.mainCheckout,
      isolate: true,
      priority: 20,
      parentSessionId: prior.sessionId,
      worktreePath: prior.worktreePath,
      branch: prior.branch,
      mainCheckout: prior.mainCheckout,
      enterprise: {
        version: 1,
        teamId: team.id,
        role: "leader",
        phase: "followup",
        turn: Math.max(...team.jobs.map(enterpriseTurn)) + 1,
        memberId: "spok",
        memberName: "Spok",
      },
    });
    setFollowup("");
    setSelectedPersonId("spok");
    setSelectedTurnJobId(null);
    toast.success("Team follow-up queued", {
      description: "Spok will continue the Grok session in the same worktree.",
    });
  };

  const openFullSession = (job: AutomationJob | null) => {
    if (!job?.sessionId) return;
    setActiveSession(job.sessionId);
    setViewMode("workspace");
    setProductMode("run");
  };

  const acceptAndReturn = async () => {
    if (!team) return;
    try {
      if (!team.acceptedAt) await acceptEnterpriseTurn(team.currentJob.id);
      if (team.currentJob.sessionId) {
        setActiveSession(team.currentJob.sessionId);
        setViewMode("workspace");
      }
      setProductMode("run");
      toast.success("Enterprise summary accepted", {
        description: "The team session is open in the regular workspace.",
      });
    } catch (error) {
      toast.error("Could not save Enterprise acceptance", {
        description:
          error instanceof Error ? error.message : "Durable save failed",
      });
    }
  };

  const showingDraft = draftMode || baseTeams.length === 0;

  if (showingDraft) {
    return (
      <EnterpriseDraft
        workspaceCwd={workspaceCwd}
        goal={goal}
        setGoal={(value) => {
          setGoal(value);
          setSubmitted(false);
        }}
        crew={crew}
        updateCrew={updateCrew}
        addCrew={() =>
          setCrew((members) => [
            ...members,
            newCrewMember(members.length),
          ])
        }
        removeCrew={(id) =>
          setCrew((members) => members.filter((member) => member.id !== id))
        }
        submitted={submitted}
        validationReason={validation.reason}
        onLaunch={launchMission}
        onOpenRepo={() => setLaunchOpen(true)}
        onBack={
          baseTeams.length
            ? () => {
                setDraftMode(false);
                setActiveTeamId(baseTeams[0]?.id ?? null);
              }
            : () => setProductMode("run")
        }
      />
    );
  }

  if (!team) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Rocket className="h-9 w-9 text-phosphor-cyan/70" />
        <h1 className="text-lg font-semibold text-phosphor-green">
          No Enterprise mission selected
        </h1>
        <Button onClick={() => setDraftMode(true)}>Create mission</Button>
      </div>
    );
  }

  const active = ACTIVE_JOB_STATUSES.has(team.currentJob.status);
  const retryable = ["failed", "cancelled", "skipped"].includes(
    team.currentJob.status
  );
  const canContinue =
    !active && !!team.currentJob.worktreePath && !!team.currentJob.mainCheckout;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_40%,color-mix(in_srgb,var(--phosphor-cyan)_7%,transparent),transparent_55%)]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-phosphor-cyan/20 bg-crt-panel px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Rocket className="h-4 w-4 shrink-0 text-phosphor-cyan" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-sm font-semibold tracking-[0.18em] text-phosphor-cyan">
                ENTERPRISE
              </h1>
              <Badge variant={statusVariant(team.status)}>
                <span aria-live="polite">{enterpriseStatusLabel(team.status)}</span>
              </Badge>
              {team.acceptedAt && (
                <Badge variant="success">Accepted</Badge>
              )}
            </div>
            <p className="truncate text-[10px] text-phosphor-green/40">
              Coordinated Grok team mission · {team.cwd}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {baseTeams.length > 1 && (
            <select
              aria-label="Enterprise mission history"
              value={team.id}
              onChange={(event) => setActiveTeamId(event.target.value)}
              className="h-8 max-w-52 rounded border border-phosphor-green/20 bg-black/40 px-2 font-mono text-[10px] text-phosphor-green outline-none focus:border-phosphor-cyan/50"
            >
              {baseTeams.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {teamTitle(candidate.goal)}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={() => setDraftMode(true)}>
            <Plus className="h-3.5 w-3.5" />
            New mission
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setProductMode("run")}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Regular UI
          </Button>
        </div>
      </header>

      <div className="enterprise-grid min-h-0 flex-1">
        <EnterpriseRoster
          team={team}
          job={selectedJob ?? team.currentJob}
          stations={stations}
          selectedPersonId={selectedPersonId}
          selectedJobId={selectedJob?.id ?? team.currentJob.id}
          onSelect={setSelectedPersonId}
          onSelectJob={(jobId) => {
            setSelectedTurnJobId(jobId);
            setSelectedPersonId("spok");
          }}
        />

        <main className="enterprise-center min-h-0 overflow-y-auto p-3" aria-label="Enterprise bridge">
          <section className="mb-3 rounded-lg border border-phosphor-green/15 bg-black/25 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-phosphor-green/40">
              <ShieldCheck className="h-3 w-3" />
              Ultimate goal
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-phosphor-green/80">
              {team.goal}
            </p>
          </section>

          <MissionTelemetry
            team={team}
            job={selectedJob ?? team.currentJob}
            laneCount={lanes.length}
            traceCount={traceNodes.length}
          />

          {selectedJob && selectedJob.id !== team.currentJob.id && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-phosphor-amber/25 bg-phosphor-amber/5 px-3 py-2 text-[10px] leading-relaxed text-phosphor-green/55">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phosphor-amber" />
              <span>
                Viewing evidence from turn {enterpriseTurn(selectedJob)}. Follow-up,
                acceptance, and the summary below always apply to latest turn {enterpriseTurn(team.currentJob)}.
              </span>
            </div>
          )}

          {selectedJob?.error && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-500/5 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-red-300">This turn needs attention</p>
                <p className="mt-0.5 break-words text-[10px] leading-relaxed text-phosphor-green/50">
                  {selectedJob.error}
                </p>
              </div>
            </div>
          )}

          <EnterpriseShip
            team={team}
            job={selectedJob ?? team.currentJob}
            stations={stations}
            selectedPersonId={selectedPersonId}
            onSelect={setSelectedPersonId}
          />

          <section className="mt-3 rounded-lg border border-phosphor-green/15 bg-crt-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-xs font-semibold text-phosphor-green">
                  Spok mission summary
                </h2>
                <p className="mt-0.5 text-[10px] text-phosphor-green/40">
                  Summary appears only from the leader&apos;s actual Grok output.
                </p>
              </div>
              {team.currentJob.branch && (
                <Badge variant="muted" className="max-w-48 truncate font-mono text-[8px]">
                  <GitBranch className="mr-1 inline h-2.5 w-2.5" />
                  {team.currentJob.branch}
                </Badge>
              )}
              {team.summary && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(team.summary);
                      toast.success("Mission summary copied");
                    } catch {
                      toast.error("Clipboard is unavailable");
                    }
                  }}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Copy
                </Button>
              )}
            </div>

            {team.summary ? (
              <div className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-phosphor-cyan/20 bg-black/35 p-3 text-xs leading-relaxed text-phosphor-green/75">
                {team.summary}
              </div>
            ) : (
              <div className="mt-3 rounded border border-dashed border-phosphor-green/20 bg-black/20 px-3 py-4 text-center text-[11px] text-phosphor-green/45">
                {active
                  ? "Spok is coordinating the crew. A substantial final response will appear here."
                  : "This turn ended without a substantial team summary. Open the full session or continue with a focused request."}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-64 flex-1">
                <span className="mb-1 block text-[9px] uppercase tracking-widest text-phosphor-green/40">
                  Follow up with the team
                </span>
                <textarea
                  value={followup}
                  onChange={(event) => setFollowup(event.target.value)}
                  disabled={!canContinue}
                  rows={2}
                  placeholder={
                    canContinue
                      ? "Ask Spok and the crew for another pass…"
                      : active
                        ? "Available when this turn finishes"
                        : "Managed worktree unavailable"
                  }
                  className="w-full resize-none rounded-md border border-phosphor-green/20 bg-black/40 px-3 py-2 text-xs text-phosphor-green outline-none placeholder:text-phosphor-green/25 focus:border-phosphor-cyan/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              <div className="flex gap-1.5">
                {active && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-phosphor-amber"
                    onClick={() => cancelBackgroundJob(team.currentJob.id)}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop turn
                  </Button>
                )}
                {retryable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const result = performInboxJobAction(
                        team.currentJob.id,
                        "retry"
                      );
                      if (result.ok) toast.success(result.message);
                      else toast.error(result.message);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canContinue || !followup.trim()}
                  onClick={followUpWithTeam}
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Follow up
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!team.currentJob.sessionId}
                  onClick={() => openFullSession(team.currentJob)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Review
                </Button>
                <Button
                  size="sm"
                  disabled={!team.summary || active}
                  onClick={acceptAndReturn}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {active
                    ? "Waiting for Spok"
                    : team.acceptedAt
                      ? "Return to Run"
                      : "Accept & return"}
                </Button>
              </div>
            </div>
          </section>
        </main>

        <EnterpriseInspector
          team={team}
          job={selectedJob ?? team.currentJob}
          station={selectedStation}
          nodes={traceNodes}
          session={selectedSession}
          onOpenSession={() => openFullSession(selectedJob)}
        />
      </div>
    </div>
  );
}

function EnterpriseDraft({
  workspaceCwd,
  goal,
  setGoal,
  crew,
  updateCrew,
  addCrew,
  removeCrew,
  submitted,
  validationReason,
  onLaunch,
  onOpenRepo,
  onBack,
}: {
  workspaceCwd: string;
  goal: string;
  setGoal: (value: string) => void;
  crew: EnterpriseCrewDraft[];
  updateCrew: (
    id: string,
    patch: Partial<Pick<EnterpriseCrewDraft, "name" | "assignment">>
  ) => void;
  addCrew: () => void;
  removeCrew: (id: string) => void;
  submitted: boolean;
  validationReason?: string;
  onLaunch: () => void;
  onOpenRepo: () => void;
  onBack: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-7" data-testid="enterprise-draft">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-phosphor-cyan/30 bg-phosphor-cyan/10">
            <Rocket className="h-5 w-5 text-phosphor-cyan" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-[0.16em] text-phosphor-cyan">
                ENTERPRISE
              </h1>
              <Badge variant="magenta">Grok crew mission</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-phosphor-green/55">
              Give Spok the ultimate goal and brief the crew. Grok performs the
              real coordination and emits the subagent lanes shown on the ship.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <section className="rounded-xl border border-phosphor-green/15 bg-crt-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-phosphor-green">
                  Mission directive
                </h2>
                <p className="text-[10px] text-phosphor-green/40">
                  The prompt is persisted only when you launch the durable job.
                </p>
              </div>
              <Badge variant={workspaceCwd ? "success" : "amber"}>
                {workspaceCwd ? "repo ready" : "repo required"}
              </Badge>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-phosphor-green/45">
                Ultimate goal
              </span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={9}
                placeholder="What should the Enterprise team accomplish? Include constraints and the definition of done."
                className="w-full resize-y rounded-lg border border-phosphor-green/20 bg-black/35 px-3 py-2.5 text-sm leading-relaxed text-phosphor-green outline-none placeholder:text-phosphor-green/25 focus:border-phosphor-cyan/50"
              />
            </label>
            <div className="mt-3 rounded border border-phosphor-green/15 bg-black/25 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-phosphor-green/40">
                <HardDrive className="h-3 w-3" />
                Repository
              </div>
              {workspaceCwd ? (
                <p className="mt-1 truncate font-mono text-[11px] text-phosphor-green/65">
                  {workspaceCwd}
                </p>
              ) : (
                <Button variant="outline" size="sm" className="mt-2" onClick={onOpenRepo}>
                  Open a repository
                </Button>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-phosphor-magenta/20 bg-crt-panel p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-phosphor-green">
                  <UsersRound className="h-4 w-4 text-phosphor-magenta" />
                  Crew briefs
                </h2>
                <p className="mt-0.5 text-[10px] text-phosphor-green/40">
                  Requested names are matched only to real provider-emitted lanes.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={crew.length >= 8}
                onClick={addCrew}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
              {crew.map((member, index) => (
                <div
                  key={member.id}
                  className="rounded-lg border border-phosphor-green/15 bg-black/25 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-[9px] text-phosphor-magenta/70">
                      STATION {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      type="button"
                      className="ml-auto rounded p-1 text-phosphor-green/35 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => removeCrew(member.id)}
                      aria-label={`Remove ${member.name || "crew member"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    aria-label={`Crew ${index + 1} name`}
                    value={member.name}
                    onChange={(event) =>
                      updateCrew(member.id, { name: event.target.value })
                    }
                    placeholder="Crew name"
                    className="h-8 text-xs"
                  />
                  <textarea
                    aria-label={`${member.name || `Crew ${index + 1}`} assignment`}
                    value={member.assignment}
                    onChange={(event) =>
                      updateCrew(member.id, { assignment: event.target.value })
                    }
                    rows={3}
                    placeholder="Their individual part of the goal…"
                    className="mt-2 w-full resize-none rounded-md border border-phosphor-green/20 bg-black/35 px-2.5 py-2 text-xs text-phosphor-green outline-none placeholder:text-phosphor-green/25 focus:border-phosphor-magenta/50"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-4 py-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-phosphor-cyan" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-phosphor-green/55">
            Enterprise launches one isolated leader run. Spok decides how to
            coordinate real Grok subagents; isolation or trust failure launches no
            agent process.
          </p>
          {submitted && validationReason && (
            <span className="text-[11px] text-red-400">{validationReason}</span>
          )}
          <Button onClick={onLaunch}>
            <Rocket className="h-4 w-4" />
            Launch Enterprise
          </Button>
        </footer>
      </div>
    </div>
  );
}

function MissionTelemetry({
  team,
  job,
  laneCount,
  traceCount,
}: {
  team: EnterpriseTeam;
  job: AutomationJob;
  laneCount: number;
  traceCount: number;
}) {
  const active = ACTIVE_JOB_STATUSES.has(job.status);
  const stages = [
    { label: "Brief", done: job.status !== "queued" },
    {
      label: "Coordinate",
      done: ["completed", "failed", "cancelled", "skipped"].includes(job.status),
      active: active && job.status !== "queued",
    },
    { label: "Synthesize", done: !!team.summary && job.id === team.currentJob.id },
    { label: "Review", done: !!team.acceptedAt && job.id === team.currentJob.id },
  ];
  return (
    <section
      className="mb-3 rounded-lg border border-phosphor-cyan/15 bg-crt-panel/80 p-3"
      aria-label="Mission telemetry"
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <TelemetryValue label="Mission turn" value={`${enterpriseTurn(job)} / ${Math.max(...team.jobs.map(enterpriseTurn))}`} />
        <TelemetryValue label="Actual lanes" value={`${laneCount} emitted`} />
        <TelemetryValue label="Visible evidence" value={`${traceCount} events`} />
        <TelemetryValue label="Safety" value={job.isolate ? "Isolated worktree" : "Isolation off"} />
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Mission progress">
        {stages.map((stage, index) => (
          <li key={stage.label} className="min-w-0">
            <div
              className={cn(
                "h-1 rounded-full bg-phosphor-green/10",
                stage.done && "bg-phosphor-green/55",
                stage.active && "enterprise-progress-active bg-phosphor-cyan/70"
              )}
            />
            <span className="mt-1 block truncate text-[8px] uppercase tracking-wider text-phosphor-green/35">
              {index + 1}. {stage.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TelemetryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-phosphor-green/10 bg-black/20 px-2.5 py-2">
      <span className="block text-[8px] uppercase tracking-widest text-phosphor-green/30">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-mono text-[10px] text-phosphor-green/65">
        {value}
      </span>
    </div>
  );
}

function EnterpriseRoster({
  team,
  job,
  stations,
  selectedPersonId,
  selectedJobId,
  onSelect,
  onSelectJob,
}: {
  team: EnterpriseTeam;
  job: AutomationJob;
  stations: EnterpriseCrewStation[];
  selectedPersonId: string;
  selectedJobId: string;
  onSelect: (id: string) => void;
  onSelectJob: (id: string) => void;
}) {
  return (
    <aside className="enterprise-roster min-h-0 overflow-y-auto border-r border-phosphor-green/15 bg-crt-panel p-2.5">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[9px] uppercase tracking-widest text-phosphor-green/40">
        <History className="h-3 w-3" />
        Mission turns
      </div>
      <div className="mb-3 space-y-1" aria-label="Enterprise turn history">
        {team.jobs.map((turnJob, index) => (
          <button
            key={turnJob.id}
            type="button"
            onClick={() => onSelectJob(turnJob.id)}
            aria-pressed={selectedJobId === turnJob.id}
            className={cn(
              "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition",
              selectedJobId === turnJob.id
                ? "border-phosphor-cyan/45 bg-phosphor-cyan/10"
                : "border-phosphor-green/10 bg-black/15 hover:border-phosphor-cyan/25"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full bg-phosphor-green/25",
                ACTIVE_JOB_STATUSES.has(turnJob.status) && "live-dot bg-phosphor-cyan",
                turnJob.status === "completed" && "bg-phosphor-green",
                ["failed", "cancelled", "skipped"].includes(turnJob.status) &&
                  "bg-red-400"
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[9px] text-phosphor-green/70">
                Turn {enterpriseTurn(turnJob)}
                {index > 0 && enterpriseTurn(team.jobs[index - 1]) === enterpriseTurn(turnJob)
                  ? " · retry"
                  : turnJob.enterprise?.phase === "followup"
                    ? " · follow-up"
                    : " · mission"}
              </span>
              <span className="block truncate text-[8px] capitalize text-phosphor-green/30">
                {turnJob.status.replace(/_/g, " ")} · {formatRelativeTime(turnJob.createdAt)}
              </span>
            </span>
            {turnJob.enterprise?.acceptedAt && (
              <CheckCircle2 className="h-3 w-3 shrink-0 text-phosphor-green" />
            )}
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[9px] uppercase tracking-widest text-phosphor-green/40">
        <UsersRound className="h-3 w-3" />
        Crew roster
        <Badge variant="muted" className="ml-auto text-[8px]">
          {stations.length + 1}
        </Badge>
      </div>
      <button
        type="button"
        onClick={() => onSelect("spok")}
        className={cn(
          "mb-1.5 w-full rounded-lg border p-2 text-left transition",
          selectedPersonId === "spok"
            ? "border-phosphor-cyan/50 bg-phosphor-cyan/10"
            : "border-phosphor-green/15 bg-black/20 hover:border-phosphor-cyan/30"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg leading-none text-phosphor-cyan">&lt;\^/&gt;</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-phosphor-green">
              Spok
            </span>
            <span className="block truncate text-[9px] text-phosphor-cyan/60">
              Grok coordinator · helm
            </span>
          </span>
          {ACTIVE_JOB_STATUSES.has(job.status) && (
            <Loader2 className="h-3 w-3 animate-spin text-phosphor-cyan" />
          )}
        </div>
      </button>
      <div className="space-y-1">
        {stations.map((station, index) => (
          <button
            key={station.id}
            type="button"
            onClick={() => onSelect(station.id)}
            className={cn(
              "w-full rounded-lg border px-2 py-2 text-left transition",
              selectedPersonId === station.id
                ? "border-phosphor-magenta/50 bg-phosphor-magenta/10"
                : "border-phosphor-green/10 bg-black/15 hover:border-phosphor-magenta/30"
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-phosphor-magenta">
                {CREW_GLYPHS[index % CREW_GLYPHS.length]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-phosphor-green/80">
                {station.name}
              </span>
              {station.status === "working" ? (
                <Radio className="h-3 w-3 text-phosphor-amber" />
              ) : station.status === "done" ? (
                <CheckCircle2 className="h-3 w-3 text-phosphor-green" />
              ) : station.status === "error" ? (
                <AlertTriangle className="h-3 w-3 text-red-400" />
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[9px] text-phosphor-green/35">
              {stationStatusLabel(station)}
            </p>
          </button>
        ))}
      </div>
    </aside>
  );
}

function EnterpriseShip({
  team,
  job,
  stations,
  selectedPersonId,
  onSelect,
}: {
  team: EnterpriseTeam;
  job: AutomationJob;
  stations: EnterpriseCrewStation[];
  selectedPersonId: string;
  onSelect: (id: string) => void;
}) {
  const spokWorking = ACTIVE_JOB_STATUSES.has(job.status);
  const visibleStations = stations.slice(0, 8);
  const hiddenStations = stations.length - visibleStations.length;
  return (
    <section
      className="enterprise-ship relative min-h-[22rem] overflow-hidden rounded-xl border border-phosphor-cyan/25 bg-black/45 p-4"
      data-testid="enterprise-ship"
      aria-label="Enterprise crew deck"
    >
      <pre
        aria-hidden="true"
        className="enterprise-hull pointer-events-none absolute inset-0 select-none overflow-hidden text-[10px] leading-[1.05] text-phosphor-cyan/15"
      >{`             .                  *                 .
       __________________________________________________
     /                                                    \\
    /    BRIDGE          MISSION LAB        ENGINEERING     \\
   |    [ HELM ]        [ STATIONS ]        [ SYSTEMS ]      |
   |                                                        |
   |            =======  CENTRAL CORRIDOR  =======           |
   |                                                        |
    \\    SCIENCE          REVIEW BAY          COMMS         /
     \\____________________________________________________/
                 \\________________________/
                        \\____________/
                              \/`}</pre>

      <div className="relative z-10 flex h-full min-h-[20rem] flex-col">
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => onSelect("spok")}
            aria-pressed={selectedPersonId === "spok"}
            aria-label={`Spok at the helm, ${enterpriseStatusLabel(team.status)}`}
            className={cn(
              "enterprise-person rounded-lg border bg-black/70 px-4 py-2 text-center transition",
              selectedPersonId === "spok"
                ? "border-phosphor-cyan/70 shadow-[0_0_20px_color-mix(in_srgb,var(--phosphor-cyan)_20%,transparent)]"
                : "border-phosphor-cyan/25 hover:border-phosphor-cyan/50",
              spokWorking && "enterprise-person-working"
            )}
          >
            <pre aria-hidden="true" className="font-mono text-xs leading-none text-phosphor-cyan">{` /\\   /\\
<  • •  >
 \\  -  /
  /|_|\\`}</pre>
            <span className="mt-1 block text-[9px] font-semibold uppercase tracking-widest text-phosphor-cyan">
              Spok · helm
            </span>
          </button>
        </div>

        <div className="mt-10 grid flex-1 grid-cols-2 content-center gap-5 sm:grid-cols-3 xl:grid-cols-4">
          {visibleStations.map((station, index) => (
            <button
              key={station.id}
              type="button"
              onClick={() => onSelect(station.id)}
              aria-pressed={selectedPersonId === station.id}
              aria-label={`${station.name}, ${stationStatusLabel(station)}`}
              className={cn(
                "enterprise-person justify-self-center rounded-lg border bg-black/65 px-3 py-2 text-center transition",
                selectedPersonId === station.id
                  ? "border-phosphor-magenta/70 bg-phosphor-magenta/10"
                  : "border-phosphor-green/15 hover:border-phosphor-magenta/45",
                station.status === "working" && "enterprise-person-working"
              )}
              style={{ animationDelay: `${(index % 4) * 120}ms` }}
            >
              <pre aria-hidden="true" className="font-mono text-xs leading-none text-phosphor-magenta">
                {CREW_ART[index % CREW_ART.length]}
              </pre>
              <span className="mt-1 block max-w-28 truncate text-[9px] font-medium text-phosphor-green/75">
                {station.name}
              </span>
              <span className="block text-[8px] text-phosphor-green/35">
                {station.status === "briefed" ? "briefed" : station.status}
              </span>
            </button>
          ))}
        </div>

        {hiddenStations > 0 && (
          <p className="mt-2 text-center text-[9px] text-phosphor-magenta/55">
            +{hiddenStations} supporting {hiddenStations === 1 ? "lane" : "lanes"} visible in the roster
          </p>
        )}

        <div className="mt-auto flex items-center justify-center gap-2 pt-4 text-[9px] uppercase tracking-widest text-phosphor-green/30">
          <Sparkles className="h-3 w-3" />
          NCC-SPOK · isolated mission deck
          <Sparkles className="h-3 w-3" />
        </div>
      </div>
    </section>
  );
}

function EnterpriseInspector({
  team,
  job,
  station,
  nodes,
  session,
  onOpenSession,
}: {
  team: EnterpriseTeam;
  job: AutomationJob;
  station: EnterpriseCrewStation | null;
  nodes: TraceNode[];
  session: Session | null;
  onOpenSession: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "thinking" | "tools" | "results">("all");
  const title = station?.name ?? "Spok";
  const subtitle = station
    ? station.lane
      ? stationStatusLabel(station)
      : "Requested assignment · no emitted lane yet"
    : `Leader · turn ${enterpriseTurn(job)} · ${
        job.id === team.currentJob.id
          ? enterpriseStatusLabel(team.status)
          : job.status.replace(/_/g, " ")
      }`;
  const filteredNodes = useMemo(() => {
    if (filter === "all") return nodes;
    const thinkingTypes = new Set(["thinking", "reasoning", "plan", "plan_update", "decision"]);
    const toolTypes = new Set(["tool_call", "tool_result", "file_change"]);
    return nodes.filter((node) =>
      filter === "thinking"
        ? thinkingTypes.has(node.type)
        : filter === "tools"
          ? toolTypes.has(node.type)
          : !thinkingTypes.has(node.type) && !toolTypes.has(node.type)
    );
  }, [filter, nodes]);
  return (
    <aside className="enterprise-inspector flex min-h-0 flex-col border-l border-phosphor-green/15 bg-crt-panel">
      <div className="shrink-0 border-b border-phosphor-green/15 p-3">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded border border-phosphor-magenta/25 bg-phosphor-magenta/5 font-mono text-sm text-phosphor-magenta">
            {station ? "o/" : "<^>"}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-phosphor-green">
              {title}
            </h2>
            <p className="truncate text-[9px] text-phosphor-green/40">{subtitle}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!job.sessionId}
            onClick={onOpenSession}
            title="Open full session"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-2 rounded border border-phosphor-green/10 bg-black/25 p-2 text-[10px] leading-relaxed text-phosphor-green/50">
          {station?.assignment || "Coordinates the ultimate goal and the actual Grok subagent crew."}
        </div>
        {station?.lane?.summary && (
          <div className="mt-2 max-h-24 overflow-y-auto rounded border border-phosphor-magenta/15 bg-phosphor-magenta/5 p-2 text-[10px] leading-relaxed text-phosphor-green/60">
            {station.lane.summary}
          </div>
        )}
        {station && (
          <Badge variant={station.lane ? "success" : "muted"} className="mt-2 text-[8px]">
            {station.lane
              ? station.requested
                ? "Requested · provider-confirmed"
                : "Provider-created support"
              : "Requested · no lane evidence"}
          </Badge>
        )}
      </div>

      <div className="shrink-0 border-b border-phosphor-green/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-phosphor-green/40">
          <Radio className="h-3 w-3" />
          Person trace
          <Badge variant="muted" className="ml-auto text-[8px]">
            {filteredNodes.length}/{nodes.length}
          </Badge>
        </div>
        <div className="mt-2 flex gap-1" role="group" aria-label="Filter person trace">
          {(["all", "thinking", "tools", "results"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={cn(
                "rounded border px-1.5 py-1 text-[8px] capitalize transition",
                filter === option
                  ? "border-phosphor-cyan/40 bg-phosphor-cyan/10 text-phosphor-cyan"
                  : "border-phosphor-green/10 text-phosphor-green/35 hover:border-phosphor-green/25"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        role="log"
        aria-label={`${title} trace`}
        aria-live="off"
      >
        {filteredNodes.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center">
            {ACTIVE_JOB_STATUSES.has(job.status) ? (
              <Loader2 className="h-5 w-5 animate-spin text-phosphor-cyan/60" />
            ) : (
              <Radio className="h-5 w-5 text-phosphor-green/25" />
            )}
            <p className="text-[10px] leading-relaxed text-phosphor-green/35">
              {station && !station.lane
                ? "This assignment is requested, but Grok has not emitted a matching subagent lane."
                : session
                  ? filter === "all"
                    ? "No displayable trace events for this person yet."
                    : `No ${filter} events in this person trace.`
                  : "The session appears after isolation and durable launch setup complete."}
            </p>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {filteredNodes.map((node) => (
              <EnterpriseTraceItem key={node.id} node={node} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function EnterpriseTraceItem({ node }: { node: TraceNode }) {
  const body = node.summary || node.content;
  return (
    <li className="rounded border border-phosphor-green/10 bg-black/25 p-2">
      <div className="flex items-center gap-1.5">
        <TraceNodeIcon type={node.type} size={12} />
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-phosphor-green/55">
          {node.toolName || node.title || node.type.replace(/_/g, " ")}
        </span>
        <span className="shrink-0 text-[8px] text-phosphor-green/25">
          {formatRelativeTime(node.timestamp)}
        </span>
      </div>
      {body && (
        <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-[10px] leading-relaxed text-phosphor-green/55">
          {body}
        </p>
      )}
    </li>
  );
}
