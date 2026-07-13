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
  buildEnterpriseDeckState,
  buildEnterpriseFollowupPrompt,
  buildEnterpriseMissionPrompt,
  buildEnterpriseTeams,
  enterpriseLanes,
  enterpriseStatusLabel,
  enterpriseTraceNodes,
  enterpriseTurn,
  MAX_ENTERPRISE_CREW,
  validateEnterpriseDraft,
  type EnterpriseCrewDraft,
  type EnterpriseCrewStation,
  type EnterpriseDeckRoom,
  type EnterpriseTeam,
} from "@/lib/enterprise";
import {
  acceptEnterpriseTurn,
  cancelBackgroundJob,
  enqueueBackgroundJob,
} from "@/lib/background-runner";
import { performInboxJobAction } from "@/lib/inbox-actions";
import {
  fetchMission,
  fetchMissionCheckpoint,
  fetchMissionList,
  missionEmptyStoreMessage,
  missionLoadRecoveryMessage,
  missionStatusLabel,
  projectMissionLeadershipView,
  workItemStatusLabel,
  type MissionClientError,
  type MissionLeadershipView,
} from "@/lib/missions/client";
import type { MissionMeta } from "@/lib/missions/types";
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

const CREW_ART = [` o\n/|\\\n/ \\`, `\\o/\n |\n/ \\`, ` O>\n/|\\\n/ \\`, `_o_\n |\n/ \\`] as const;

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
  const first = goal.trim().split(/\r?\n/, 1)[0] || "Spok mission";
  return first.length > 54 ? `${first.slice(0, 53)}…` : first;
}

function statusVariant(status: EnterpriseTeam["status"]) {
  if (status === "complete") return "success" as const;
  if (status === "ready_review") return "cyan" as const;
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
  const [crew, setCrew] = useState<EnterpriseCrewDraft[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState("spok");
  const [followup, setFollowup] = useState("");

  /** Mission v1 durable store — leadership evidence before spectacle. */
  type DurableListState =
    | { status: "loading" }
    | { status: "ready"; missions: MissionMeta[] }
    | { status: "error"; error: MissionClientError };
  type DurableDetailState =
    | { status: "idle" }
    | { status: "loading"; missionId: string }
    | {
        status: "ready";
        missionId: string;
        view: MissionLeadershipView;
      }
    | { status: "error"; missionId: string; error: MissionClientError };

  const [durableList, setDurableList] = useState<DurableListState>({
    status: "loading",
  });
  const [selectedDurableId, setSelectedDurableId] = useState<string | null>(
    null
  );
  const [durableDetail, setDurableDetail] = useState<DurableDetailState>({
    status: "idle",
  });
  const [durableListNonce, setDurableListNonce] = useState(0);
  const [durableDetailNonce, setDurableDetailNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setDurableList({ status: "loading" });
    void (async () => {
      const result = await fetchMissionList({ signal: ctrl.signal });
      if (cancelled) return;
      if (!result.ok) {
        setDurableList({ status: "error", error: result.error });
        return;
      }
      setDurableList({ status: "ready", missions: result.value.missions });
      setSelectedDurableId((prev) => {
        if (prev && result.value.missions.some((m) => m.id === prev)) {
          return prev;
        }
        return result.value.missions[0]?.id ?? null;
      });
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [durableListNonce]);

  useEffect(() => {
    if (!selectedDurableId) {
      setDurableDetail({ status: "idle" });
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const missionId = selectedDurableId;
    setDurableDetail({ status: "loading", missionId });
    void (async () => {
      const [missionResult, checkpointResult] = await Promise.all([
        fetchMission(missionId, { signal: ctrl.signal }),
        fetchMissionCheckpoint(missionId, { signal: ctrl.signal }),
      ]);
      if (cancelled) return;
      if (!missionResult.ok) {
        setDurableDetail({
          status: "error",
          missionId,
          error: missionResult.error,
        });
        return;
      }
      const checkpoint = checkpointResult.ok
        ? checkpointResult.value.checkpoint
        : null;
      const persisted = checkpointResult.ok
        ? checkpointResult.value.persisted === false
          ? false
          : checkpointResult.value.persisted === true
            ? true
            : null
        : null;
      const view = projectMissionLeadershipView(
        missionResult.value.mission,
        checkpoint,
        { checkpointPersisted: persisted }
      );
      setDurableDetail({ status: "ready", missionId, view });
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [selectedDurableId, durableDetailNonce]);

  const durableMissions =
    durableList.status === "ready" ? durableList.missions : [];
  const hasDurableMissions = durableMissions.length > 0;
  const durableListBlocking =
    durableList.status === "loading" || durableList.status === "error";

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
      toast.error(validation.reason || "Mission brief is incomplete");
      return;
    }
    const assignedCrew = crew.filter(
      (member) => member.name.trim() && member.assignment.trim()
    );
    const teamId = `ent-${nanoid(10)}`;
    enqueueBackgroundJob({
      title: `Mission · ${teamTitle(goal)}`,
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
    toast.success("Spok mission queued", {
      description:
        "Spok will plan and lead real Grok agents inside an isolated worktree.",
    });
  };

  const followUpWithTeam = () => {
    if (!team || !followup.trim()) return;
    const prior = team.currentJob;
    if (!prior.worktreePath || !prior.mainCheckout) {
      toast.error("The managed mission worktree is unavailable", {
        description: "Open the full session or retry the mission safely.",
      });
      return;
    }
    enqueueBackgroundJob({
      title: `Mission follow-up · ${teamTitle(followup)}`,
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
      toast.success("Mission checkpoint accepted", {
        description: "The team session is open in the regular workspace.",
      });
    } catch (error) {
      toast.error("Could not save mission acceptance", {
        description:
          error instanceof Error ? error.message : "Durable save failed",
      });
    }
  };

  const showingDraft =
    draftMode ||
    (baseTeams.length === 0 && !hasDurableMissions && !durableListBlocking);

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
          baseTeams.length || hasDurableMissions
            ? () => {
                setDraftMode(false);
                setActiveTeamId(baseTeams[0]?.id ?? null);
              }
            : () => setProductMode("run")
        }
      />
    );
  }

  /** Durable-only control room when Mission v1 has records but no live job team. */
  if (!team) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_40%,color-mix(in_srgb,var(--phosphor-cyan)_7%,transparent),transparent_55%)]">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-phosphor-cyan/20 bg-crt-panel px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Rocket className="h-4 w-4 shrink-0 text-phosphor-cyan" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-sm font-semibold tracking-[0.18em] text-phosphor-cyan">
                  MISSIONS
                </h1>
                <Badge variant="magenta">Spok leads</Badge>
              </div>
              <p className="truncate text-[10px] text-phosphor-green/40">
                Durable Mission v1 evidence · live job turns appear when Spok
                launches an isolated run
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setDraftMode(true)}>
              <Plus className="h-3.5 w-3.5" />
              New live turn
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setProductMode("run")}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Run
            </Button>
          </div>
        </header>
        <main
          className="min-h-0 flex-1 overflow-y-auto p-3"
          aria-label="Spok mission control"
        >
          <DurableMissionLeadershipPanel
            listState={durableList}
            detailState={durableDetail}
            selectedId={selectedDurableId}
            onSelect={setSelectedDurableId}
            onRetryList={() => setDurableListNonce((n) => n + 1)}
            onRetryDetail={() => setDurableDetailNonce((n) => n + 1)}
            onCreateLive={() => setDraftMode(true)}
          />
        </main>
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
                MISSIONS
              </h1>
              <Badge variant={statusVariant(team.status)}>
                <span aria-live="polite">{enterpriseStatusLabel(team.status)}</span>
              </Badge>
              {team.acceptedAt && (
                <Badge variant="success">Accepted</Badge>
              )}
            </div>
            <p className="truncate text-[10px] text-phosphor-green/40">
              <span className="uppercase">{team.statusSource}</span> · {team.statusReason} · {team.cwd}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {baseTeams.length > 1 && (
            <select
              aria-label="Mission history"
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
            Back to Run
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

        <main className="enterprise-center min-h-0 overflow-y-auto p-3" aria-label="Spok mission control">
          <DurableMissionLeadershipPanel
            listState={durableList}
            detailState={durableDetail}
            selectedId={selectedDurableId}
            onSelect={setSelectedDurableId}
            onRetryList={() => setDurableListNonce((n) => n + 1)}
            onRetryDetail={() => setDurableDetailNonce((n) => n + 1)}
            onCreateLive={() => setDraftMode(true)}
          />

          <section className="mb-3 rounded-lg border border-phosphor-green/15 bg-black/25 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-phosphor-green/40">
              <ShieldCheck className="h-3 w-3" />
              Live turn outcome
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

          <section className="mt-3 rounded-lg border border-phosphor-green/15 bg-crt-panel p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-xs font-semibold text-phosphor-green">
                  Spok leader checkpoint
                </h2>
                <p className="mt-0.5 text-[10px] text-phosphor-green/40">
                  Evidence appears only from the leader&apos;s actual Grok output and canonical lifecycle state.
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
                  ? "Spok is leading the mission. A durable checkpoint will appear here."
                  : "This turn ended without a substantial leader checkpoint. Inspect the session or continue with a focused repair request."}
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
                      ? "Ask Spok to revise the plan or lead another pass…"
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

          <details className="mt-3 rounded-lg border border-phosphor-green/15 bg-crt-panel">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-phosphor-green/75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-phosphor-cyan/60">
              Team activity map
              <span className="ml-2 text-[11px] font-normal text-phosphor-green/45">
                Optional visualization · status comes from evidence above
              </span>
            </summary>
            <div className="border-t border-phosphor-green/10 p-3">
              <EnterpriseShip
                team={team}
                stations={stations}
                session={selectedSession}
                selectedPersonId={selectedPersonId}
                onSelect={setSelectedPersonId}
              />
            </div>
          </details>
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

function durableMissionStatusVariant(
  status: MissionLeadershipView["status"] | MissionMeta["status"]
) {
  if (status === "completed" || status === "archived") return "success" as const;
  if (status === "review_ready") return "cyan" as const;
  if (status === "failed" || status === "cancelled") return "error" as const;
  if (status === "blocked") return "error" as const;
  if (status === "active") return "cyan" as const;
  if (status === "draft") return "muted" as const;
  return "amber" as const;
}

function workItemEvidenceBadge(
  wi: MissionLeadershipView["milestones"][number]["workItems"][number]
) {
  if (wi.processExitOnly) return "Process exit only · not completion";
  if (wi.hasTerminalEvidence) return "Terminal evidence recorded";
  if (wi.expectedEvidence.length > 0) {
    return `Expected evidence · ${wi.expectedEvidence.length}`;
  }
  return "No evidence yet";
}

/**
 * Durable Mission v1 leadership evidence — always above optional team map.
 * Loading/empty/error are actionable; specialists are plan owners only.
 */
function DurableMissionLeadershipPanel({
  listState,
  detailState,
  selectedId,
  onSelect,
  onRetryList,
  onRetryDetail,
  onCreateLive,
}: {
  listState:
    | { status: "loading" }
    | { status: "ready"; missions: MissionMeta[] }
    | { status: "error"; error: MissionClientError };
  detailState:
    | { status: "idle" }
    | { status: "loading"; missionId: string }
    | {
        status: "ready";
        missionId: string;
        view: MissionLeadershipView;
      }
    | { status: "error"; missionId: string; error: MissionClientError };
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetryList: () => void;
  onRetryDetail: () => void;
  onCreateLive: () => void;
}) {
  if (listState.status === "loading") {
    return (
      <section
        className="mb-3 rounded-lg border border-phosphor-cyan/20 bg-crt-panel p-3"
        data-testid="durable-mission-panel"
        aria-label="Durable mission leadership"
        aria-busy="true"
      >
        <div className="flex items-start gap-2">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-phosphor-cyan" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-phosphor-green">
              Loading durable missions
            </h2>
            <p className="mt-0.5 text-[10px] text-phosphor-green/45">
              Fetching Mission v1 outcome, plan, and checkpoint from the local
              store. This times out into a retryable error — never an infinite
              spinner.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetryList}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  if (listState.status === "error") {
    const recovery = missionLoadRecoveryMessage(listState.error);
    return (
      <section
        role="alert"
        className="mb-3 rounded-lg border border-red-400/25 bg-red-500/5 p-3"
        data-testid="durable-mission-panel"
        aria-label="Durable mission leadership"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-red-300">
              {recovery.title}
            </h2>
            <p className="mt-0.5 text-[10px] leading-relaxed text-phosphor-green/50">
              {recovery.body}
            </p>
            <p className="mt-1 text-[10px] text-phosphor-green/35">
              Live job turns (if any) still appear below. Decorative team maps
              are not execution evidence.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetryList}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      </section>
    );
  }

  if (listState.missions.length === 0) {
    const empty = missionEmptyStoreMessage();
    return (
      <section
        className="mb-3 rounded-lg border border-dashed border-phosphor-green/25 bg-black/20 p-3"
        data-testid="durable-mission-panel"
        aria-label="Durable mission leadership"
      >
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-phosphor-cyan/70" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-phosphor-green">
              {empty.title}
            </h2>
            <p className="mt-0.5 text-[10px] leading-relaxed text-phosphor-green/45">
              {empty.body}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onCreateLive}>
            <Plus className="h-3.5 w-3.5" />
            New live turn
          </Button>
        </div>
      </section>
    );
  }

  const view =
    detailState.status === "ready" &&
    detailState.missionId === selectedId
      ? detailState.view
      : null;

  return (
    <section
      className="mb-3 rounded-lg border border-phosphor-cyan/25 bg-crt-panel p-3"
      data-testid="durable-mission-panel"
      aria-label="Durable mission leadership"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-phosphor-cyan/70">
            <ShieldCheck className="h-3 w-3" />
            Durable leadership evidence · Mission v1
          </div>
          <p className="mt-0.5 text-[10px] text-phosphor-green/40">
            Spok owns plan truth. Requested specialists are plan owners — not
            running agents without provider lanes.
          </p>
        </div>
        {listState.missions.length > 1 && (
          <select
            aria-label="Durable mission"
            value={selectedId ?? listState.missions[0]?.id ?? ""}
            onChange={(event) => onSelect(event.target.value)}
            className="h-8 max-w-64 rounded border border-phosphor-green/20 bg-black/40 px-2 font-mono text-[10px] text-phosphor-green outline-none focus:border-phosphor-cyan/50"
          >
            {listState.missions.map((m) => (
              <option key={m.id} value={m.id}>
                {missionStatusLabel(m.status)} ·{" "}
                {m.outcome.length > 48
                  ? `${m.outcome.slice(0, 47)}…`
                  : m.outcome}
              </option>
            ))}
          </select>
        )}
        <Button variant="ghost" size="sm" onClick={onRetryList}>
          <RotateCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {detailState.status === "loading" && (
        <div
          className="flex items-center gap-2 rounded border border-phosphor-green/15 bg-black/25 px-3 py-3 text-[11px] text-phosphor-green/55"
          aria-busy="true"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-phosphor-cyan" />
          Loading mission plan, milestones, and checkpoint…
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onRetryDetail}
          >
            Retry
          </Button>
        </div>
      )}

      {detailState.status === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-red-400/25 bg-red-500/5 px-3 py-2.5"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-red-300">
              {missionLoadRecoveryMessage(detailState.error).title}
            </p>
            <p className="mt-0.5 text-[10px] text-phosphor-green/50">
              {missionLoadRecoveryMessage(detailState.error).body}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetryDetail}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}

      {view && (
        <div className="space-y-3" data-testid="durable-mission-evidence">
          <div className="rounded border border-phosphor-green/15 bg-black/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={durableMissionStatusVariant(view.status)}>
                {view.statusLabel}
              </Badge>
              <Badge variant="muted" className="font-mono text-[8px]">
                {view.statusSource}
              </Badge>
              <span className="font-mono text-[9px] text-phosphor-green/35">
                {view.id}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-phosphor-green">
              {view.outcome}
            </h3>
            {view.statusReason && (
              <p className="mt-1 text-[10px] leading-relaxed text-phosphor-green/50">
                <span className="uppercase tracking-wider text-phosphor-green/35">
                  Reason ·{" "}
                </span>
                {view.statusReason}
              </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-2.5 py-2">
                <span className="block text-[9px] uppercase tracking-widest text-phosphor-cyan/70">
                  Next action
                </span>
                <span className="mt-0.5 block text-xs text-phosphor-green/80">
                  {view.nextAction.label}
                </span>
                <span className="mt-0.5 block font-mono text-[9px] text-phosphor-green/35">
                  {view.nextAction.kind}
                </span>
              </div>
              <div className="rounded border border-phosphor-green/10 bg-black/20 px-2.5 py-2">
                <span className="block text-[9px] uppercase tracking-widest text-phosphor-green/45">
                  Repository (authority-neutral read)
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-phosphor-green/65">
                  {view.repository || "—"}
                </span>
              </div>
            </div>
            {view.definitionOfDone.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-[10px] text-phosphor-green/55">
                {view.definitionOfDone.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          {view.checkpoint && (
            <div
              className="rounded border border-phosphor-amber/20 bg-black/25 p-3"
              data-testid="durable-mission-checkpoint"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-semibold text-phosphor-green">
                  Latest checkpoint
                </h4>
                <Badge variant="muted" className="text-[8px]">
                  {view.checkpoint.persisted === false
                    ? "Materialised · not yet persisted"
                    : view.checkpoint.persisted === true
                      ? "Persisted"
                      : "Checkpoint"}
                </Badge>
                <span className="font-mono text-[9px] text-phosphor-green/35">
                  {formatRelativeTime(view.checkpoint.at)}
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div>
                  <span className="text-[9px] uppercase tracking-widest text-phosphor-green/40">
                    Active
                  </span>
                  <p className="mt-0.5 font-mono text-[10px] text-phosphor-green/70">
                    {view.checkpoint.active.length
                      ? view.checkpoint.active.join(", ")
                      : "None"}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] uppercase tracking-widest text-phosphor-green/40">
                    Completed
                  </span>
                  <p className="mt-0.5 font-mono text-[10px] text-phosphor-green/70">
                    {view.checkpoint.completed.length
                      ? view.checkpoint.completed.join(", ")
                      : "None"}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] uppercase tracking-widest text-phosphor-green/40">
                    Evidence refs
                  </span>
                  <p className="mt-0.5 font-mono text-[10px] text-phosphor-green/70">
                    {view.checkpoint.evidenceRefs.length
                      ? view.checkpoint.evidenceRefs.join(", ")
                      : "None recorded"}
                  </p>
                </div>
              </div>
              {view.checkpoint.blocked.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Checkpoint blockers">
                  {view.checkpoint.blocked.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-start gap-1.5 text-[10px] text-red-300/90"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        <span className="font-mono">{b.id}</span> · {b.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {view.checkpoint.risks.length > 0 && (
                <div className="mt-2">
                  <span className="text-[9px] uppercase tracking-widest text-phosphor-amber/70">
                    Risks
                  </span>
                  <ul className="mt-1 list-inside list-disc text-[10px] text-phosphor-green/55">
                    {view.checkpoint.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {view.checkpoint.nextDecisions.length > 0 && (
                <div className="mt-2">
                  <span className="text-[9px] uppercase tracking-widest text-phosphor-cyan/70">
                    Next decisions
                  </span>
                  <ul className="mt-1 list-inside list-disc text-[10px] text-phosphor-green/65">
                    {view.checkpoint.nextDecisions.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {(view.milestones.length > 0 ||
            view.workItemsWithoutMilestone.length > 0) && (
            <div data-testid="durable-mission-plan">
              <h4 className="mb-1.5 text-xs font-semibold text-phosphor-green">
                Plan · milestones & work items
              </h4>
              <div className="space-y-2">
                {view.milestones.map((ms) => (
                  <div
                    key={ms.id}
                    className="rounded border border-phosphor-green/15 bg-black/25 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-phosphor-green/85">
                        {ms.title}
                      </span>
                      <Badge variant="muted" className="text-[8px]">
                        {ms.status}
                      </Badge>
                      <span className="font-mono text-[8px] text-phosphor-green/30">
                        {ms.id}
                      </span>
                    </div>
                    {ms.exitCriteria.length > 0 && (
                      <p className="mt-1 text-[9px] text-phosphor-green/40">
                        Exit · {ms.exitCriteria.join("; ")}
                      </p>
                    )}
                    {ms.unsatisfiedDeps.length > 0 && (
                      <p className="mt-1 text-[9px] text-phosphor-amber/80">
                        Unsatisfied deps · {ms.unsatisfiedDeps.join(", ")}
                      </p>
                    )}
                    <ul className="mt-2 space-y-1.5">
                      {ms.workItems.map((wi) => (
                        <li
                          key={wi.id}
                          className="rounded border border-phosphor-green/10 bg-black/20 px-2 py-1.5"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-phosphor-green/80">
                              {wi.title}
                            </span>
                            <Badge variant="muted" className="text-[8px]">
                              {workItemStatusLabel(wi.status)}
                            </Badge>
                            <Badge
                              variant={wi.ownerIsSpok ? "cyan" : "muted"}
                              className="text-[8px]"
                            >
                              {wi.ownerIsSpok
                                ? "Spok"
                                : `${wi.owner} · plan only`}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-[9px] text-phosphor-green/40">
                            Deps · {wi.dependencyState}
                            {wi.unsatisfiedDeps.length
                              ? ` (waiting on ${wi.unsatisfiedDeps.join(", ")})`
                              : ""}
                            {" · "}
                            {workItemEvidenceBadge(wi)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {view.workItemsWithoutMilestone.map((wi) => (
                  <div
                    key={wi.id}
                    className="rounded border border-phosphor-green/10 bg-black/20 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-phosphor-green/80">
                        {wi.title}
                      </span>
                      <Badge variant="muted" className="text-[8px]">
                        {workItemStatusLabel(wi.status)}
                      </Badge>
                      <Badge
                        variant={wi.ownerIsSpok ? "cyan" : "muted"}
                        className="text-[8px]"
                      >
                        {wi.ownerIsSpok ? "Spok" : `${wi.owner} · plan only`}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[9px] text-phosphor-green/40">
                      Deps · {wi.dependencyState} · {workItemEvidenceBadge(wi)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view.isEmptyPlan && (
            <p className="rounded border border-dashed border-phosphor-green/20 bg-black/15 px-3 py-2 text-[10px] text-phosphor-green/45">
              This durable mission has no milestones or work items yet. That is
              an empty plan — not decorative progress.
            </p>
          )}

          {view.specialistPlanOwners.length > 0 && (
            <div className="rounded border border-phosphor-magenta/15 bg-black/20 px-2.5 py-2">
              <span className="text-[9px] uppercase tracking-widest text-phosphor-magenta/70">
                Specialist plan owners (not running agents)
              </span>
              <ul className="mt-1 space-y-0.5 text-[10px] text-phosphor-green/50">
                {view.specialistPlanOwners.map((s) => (
                  <li key={s.owner}>
                    <span className="font-medium text-phosphor-green/70">
                      {s.owner}
                    </span>
                    {" · "}
                    {s.workItemIds.join(", ")} — {s.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
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
                MISSIONS
              </h1>
              <Badge variant="magenta">Spok leads</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-phosphor-green/55">
              Give Spok the outcome and definition of done. Spok plans the work,
              leads real Grok agents, integrates their evidence, and leaves a durable checkpoint.
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
                Project outcome
              </span>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={9}
                placeholder="What should Spok accomplish? Include constraints, risks, and the definition of done."
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
                  Specialist suggestions
                </h2>
                <p className="mt-0.5 text-[10px] text-phosphor-green/40">
                  Optional. Spok can design the team, or use up to {MAX_ENTERPRISE_CREW} suggested specialists. Names match only real provider lanes.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={crew.length >= MAX_ENTERPRISE_CREW}
                onClick={addCrew}
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
              {crew.length === 0 && (
                <div className="rounded-lg border border-dashed border-phosphor-magenta/25 bg-black/20 p-4 text-center text-xs leading-relaxed text-phosphor-green/50">
                  No specialists preset. Spok will decompose the outcome and choose the smallest useful Grok team.
                </div>
              )}
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
                      aria-label={`Remove ${member.name || "specialist suggestion"}`}
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
            A mission launches one isolated Spok leader run. Spok plans and
            coordinates real Grok agents; isolation or trust failure launches no
            process, and requested specialists never count as running without provider evidence.
          </p>
          {submitted && validationReason && (
            <span className="text-[11px] text-red-400">{validationReason}</span>
          )}
          <Button onClick={onLaunch}>
            <Rocket className="h-4 w-4" />
            Launch mission
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
      aria-label="Mission evidence summary"
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <TelemetryValue label="Mission turn" value={`${enterpriseTurn(job)} / ${Math.max(...team.jobs.map(enterpriseTurn))}`} />
        <TelemetryValue label="Actual lanes" value={`${laneCount} emitted`} />
        <TelemetryValue label="Visible evidence" value={`${traceCount} events`} />
        <TelemetryValue label="Safety" value={job.isolate ? "Isolated worktree" : "Isolation off"} />
        <TelemetryValue label="Next action" value={team.nextAction.label} />
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
            <span className="mt-1 block truncate text-[10px] uppercase tracking-wider text-phosphor-green/50">
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
      <span className="block text-[10px] uppercase tracking-widest text-phosphor-green/45">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-mono text-xs text-phosphor-green/75">
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
      <div className="mb-3 space-y-1" aria-label="Mission turn history">
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
        Specialists
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
              Accountable leader · mission control
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
  stations,
  session,
  selectedPersonId,
  onSelect,
}: {
  team: EnterpriseTeam;
  stations: EnterpriseCrewStation[];
  session: Session | null;
  selectedPersonId: string;
  onSelect: (id: string) => void;
}) {
  const visibleStations = stations.slice(0, MAX_ENTERPRISE_CREW);
  const deck = useMemo(
    () => buildEnterpriseDeckState(visibleStations, session?.nodes ?? {}),
    [visibleStations, session]
  );
  const latestCoordination = deck.coordination[0];
  const spokRoom: EnterpriseDeckRoom =
    latestCoordination?.tone === "blocked" || latestCoordination?.tone === "message"
      ? "comms"
      : latestCoordination?.tone === "report"
        ? "review"
        : "bridge";
  const actors = [
    {
      id: "spok",
      name: "Spok",
      room: spokRoom,
      activity: latestCoordination
        ? `${latestCoordination.from} → ${latestCoordination.to} · ${latestCoordination.label}`
        : enterpriseStatusLabel(team.status),
    },
    ...deck.actors,
  ];
  const roomGroups = new Map<EnterpriseDeckRoom, string[]>();
  for (const actor of actors) {
    const occupants = roomGroups.get(actor.room) ?? [];
    occupants.push(actor.id);
    roomGroups.set(actor.room, occupants);
  }

  const positionFor = (room: EnterpriseDeckRoom, id: string) => {
    const centers: Record<EnterpriseDeckRoom, { left: number; top: number }> = {
      bridge: { left: 50, top: 10 },
      ready: { left: 69, top: 18 },
      science: { left: 18, top: 29 },
      mission: { left: 50, top: 29 },
      engineering: { left: 82, top: 29 },
      review: { left: 24, top: 49 },
      comms: { left: 76, top: 49 },
    };
    const occupants = roomGroups.get(room) ?? [id];
    const index = Math.max(0, occupants.indexOf(id));
    const slots =
      occupants.length <= 1
        ? [{ x: 0, y: 0 }]
        : occupants.length === 2
          ? [{ x: -4.5, y: 0 }, { x: 4.5, y: 0 }]
          : occupants.length === 3
            ? [{ x: 0, y: -3 }, { x: -4.5, y: 3 }, { x: 4.5, y: 3 }]
            : [
                { x: -4.5, y: -3 },
                { x: 4.5, y: -3 },
                { x: -4.5, y: 3 },
                { x: 4.5, y: 3 },
              ];
    const slot = slots[index] ?? { x: 0, y: 0 };
    return {
      left: `${centers[room].left + slot.x}%`,
      top: `${centers[room].top + slot.y}%`,
    };
  };
  return (
    <section
      className="enterprise-ship relative min-h-[24rem] overflow-hidden rounded-xl border border-phosphor-cyan/25 bg-black/55"
      data-testid="enterprise-ship"
      aria-label="Optional mission team map"
    >
      <pre
        aria-hidden="true"
        className="enterprise-deck-map pointer-events-none absolute inset-x-0 top-3 m-auto select-none text-phosphor-cyan/55"
      >{`                              .          *
                    __________________________
              _____/      BRIDGE  [B]         \\_____
             /    +--------------------------+      \\
            /     |   HELM        READY [Y]  |       \\
       ____/------+------------+-------------+--------\\____
      / SCIENCE [S] | MISSION LAB [M] | ENGINEERING [E]   \\
     /--------------+-----------------+---------------------\\
    |                                                       |
    |================= MAIN CORRIDOR ========================|
    |                                                       |
    |  REVIEW BAY [R]   |   TURBOLIFT   |    COMMS [C]      |
     \\-----------------+---------------+-------------------/
      \\                                                   /
       \\________________ NCC-SPOK _______________________/
                         \\____________/
                              \\__/`}</pre>

      <div
        className={cn(
          "enterprise-route enterprise-route-vertical",
          deck.coordination.length && "enterprise-route-active"
        )}
        aria-hidden="true"
      />
      <div
        className={cn(
          "enterprise-route enterprise-route-horizontal",
          deck.coordination.length && "enterprise-route-active"
        )}
        aria-hidden="true"
      />

      {actors.map((actor, index) => {
        const station = visibleStations.find((candidate) => candidate.id === actor.id);
        const isSpok = actor.id === "spok";
        return (
          <button
            key={actor.id}
            type="button"
            onClick={() => onSelect(actor.id)}
            aria-pressed={selectedPersonId === actor.id}
            aria-label={`${actor.name}, ${actor.activity}`}
            title={actor.activity}
            className={cn(
              "enterprise-actor absolute z-10 -translate-x-1/2 -translate-y-1/2 text-center",
              selectedPersonId === actor.id && "enterprise-actor-selected",
              isSpok ? "text-phosphor-cyan" : "text-phosphor-magenta",
              station?.status === "error" && "text-red-400"
            )}
            style={positionFor(actor.room, actor.id)}
            data-room={actor.room}
          >
            <pre aria-hidden="true" className="enterprise-actor-art font-mono text-[11px] leading-[0.8]">
              {isSpok ? ` /\\/\\\n< •• >\n /||\\` : CREW_ART[(index - 1) % CREW_ART.length]}
            </pre>
            <span className="enterprise-actor-label mt-1 block max-w-24 truncate rounded bg-black/85 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide">
              {actor.name}
            </span>
          </button>
        );
      })}

      <div className="enterprise-comms-log absolute inset-x-3 bottom-3 z-20 rounded border border-phosphor-green/15 bg-black/80 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[8px] uppercase tracking-[0.18em] text-phosphor-green/35">
          <Radio className="h-3 w-3" />
          Coordination channel · movement follows these events
        </div>
        {deck.coordination.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {deck.coordination.slice(0, 3).map((event) => (
              <span
                key={event.id}
                className={cn(
                  "font-mono text-[9px] text-phosphor-green/55",
                  event.tone === "blocked" && "text-red-300",
                  event.tone === "message" && "text-phosphor-cyan/75",
                  event.tone === "report" && "text-phosphor-green/80"
                )}
              >
                {event.from} → {event.to} · {event.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[9px] text-phosphor-green/35">
            No provider task or message events yet; suggested specialists are not running agents.
          </p>
        )}
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
          {station?.assignment || "Owns the mission plan, delegation, integration, evidence, and next safe action."}
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
