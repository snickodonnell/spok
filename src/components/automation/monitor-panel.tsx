"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSpokStore } from "@/lib/store";
import {
  fetchAutomationBundle,
  saveSchedule,
  removeSchedule,
  saveChannel,
  removeChannel,
  type AutomationBundleResponse,
} from "@/lib/automation-client";
import {
  enqueueBackgroundJob,
  cancelBackgroundJob,
  tickSchedules,
} from "@/lib/background-runner";
import { jobStatusLabel } from "@/lib/automation/queue";
import {
  extractSubagentLanes,
  mergeSubagentSummaries,
} from "@/lib/automation/subagent-lanes";
import type {
  AutomationJob,
  ScheduleDefinition,
  ScheduleIntervalUnit,
} from "@/lib/automation/types";
import { toast } from "sonner";
import {
  Loader2,
  Layers,
  Play,
  Square,
  RefreshCw,
  Clock,
  Radio,
  GitCompare,
  Plus,
  Trash2,
  ExternalLink,
  Shield,
  Bot,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Copy,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";

type TabId = "queue" | "schedules" | "channels" | "compare" | "lanes";

function JobStatusBadge({ status }: { status: AutomationJob["status"] }) {
  const variant =
    status === "completed"
      ? ("cyan" as const)
      : status === "failed"
        ? ("error" as const)
        : status === "running"
          ? ("amber" as const)
          : status === "waiting_approval"
            ? ("amber" as const)
            : status === "cancelled" || status === "skipped"
              ? ("muted" as const)
              : ("muted" as const);
  return (
    <Badge variant={variant} className="text-[9px]">
      {jobStatusLabel(status)}
    </Badge>
  );
}

export function MonitorPanel() {
  const open = useSpokStore((s) => s.monitorOpen);
  const setOpen = useSpokStore((s) => s.setMonitorOpen);
  const jobs = useSpokStore((s) => s.automationJobs);
  const sessions = useSpokStore((s) => s.sessions);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const clearFinishedJobs = useSpokStore((s) => s.clearFinishedJobs);
  const compareSessionIds = useSpokStore((s) => s.compareSessionIds);
  const setCompareSessionIds = useSpokStore((s) => s.setCompareSessionIds);
  const selectedSubagentLaneId = useSpokStore((s) => s.selectedSubagentLaneId);
  const setSelectedSubagentLaneId = useSpokStore(
    (s) => s.setSelectedSubagentLaneId
  );

  const session = activeSessionId ? sessions[activeSessionId] : null;
  const cwd = session?.config.cwd;

  const [tab, setTab] = useState<TabId>("queue");
  const [loading, setLoading] = useState(false);
  const [bundle, setBundle] = useState<AutomationBundleResponse | null>(null);

  // Quick queue form
  const [bgTitle, setBgTitle] = useState("");
  const [bgPrompt, setBgPrompt] = useState("");
  const [bgIsolate, setBgIsolate] = useState(true);

  // Schedule form
  const [schName, setSchName] = useState("");
  const [schPrompt, setSchPrompt] = useState("");
  const [schEvery, setSchEvery] = useState("24");
  const [schUnit, setSchUnit] = useState<ScheduleIntervalUnit>("hours");
  const [schIsolate, setSchIsolate] = useState(true);

  // Channel form
  const [chName, setChName] = useState("");
  const [chSecretShown, setChSecretShown] = useState<string | null>(null);

  // Compare selection
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAutomationBundle();
      setBundle(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load automation");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const activeJobs = useMemo(
    () =>
      jobs.filter((j) =>
        ["queued", "running", "waiting_approval"].includes(j.status)
      ),
    [jobs]
  );
  const historyJobs = useMemo(
    () =>
      jobs.filter(
        (j) => !["queued", "running", "waiting_approval"].includes(j.status)
      ),
    [jobs]
  );

  const sessionList = useMemo(
    () =>
      Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  const lanes = useMemo(() => {
    if (!session) return [];
    if (session.subagentLanes?.length) return session.subagentLanes;
    return extractSubagentLanes(session.nodes);
  }, [session]);

  const openSession = (id: string) => {
    setActiveSession(id);
    setViewMode("workspace");
    setOpen(false);
    toast.message("Opened session");
  };

  const queueNow = () => {
    if (!cwd) {
      toast.error("Open a workspace first");
      return;
    }
    if (!bgPrompt.trim()) {
      toast.error("Prompt required");
      return;
    }
    enqueueBackgroundJob({
      title: bgTitle.trim() || bgPrompt.trim().slice(0, 48),
      prompt: bgPrompt.trim(),
      cwd,
      isolate: bgIsolate,
      parentSessionId: activeSessionId ?? undefined,
    });
    setBgPrompt("");
    setBgTitle("");
    toast.success("Queued in background — stay in your current session");
    setTab("queue");
  };

  const addSchedule = async () => {
    if (!cwd) {
      toast.error("Open a workspace first");
      return;
    }
    if (!schName.trim() || !schPrompt.trim()) {
      toast.error("Name and prompt required");
      return;
    }
    try {
      await saveSchedule({
        name: schName.trim(),
        cwd,
        prompt: schPrompt.trim(),
        every: Math.max(1, parseInt(schEvery, 10) || 24),
        unit: schUnit,
        isolate: schIsolate,
        requireTrusted: true,
        enabled: true,
      });
      setSchName("");
      setSchPrompt("");
      toast.success("Schedule saved — runs only in trusted workspaces");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const addChannel = async () => {
    if (!cwd) {
      toast.error("Open a workspace first");
      return;
    }
    if (!chName.trim()) {
      toast.error("Channel name required");
      return;
    }
    try {
      const ch = await saveChannel({
        name: chName.trim(),
        cwd,
        targetMode: "queue_background",
        isolate: true,
        requireTrusted: true,
        enabled: true,
      });
      setChName("");
      if (ch.secret) setChSecretShown(ch.secret);
      toast.success("Channel created — copy the secret now");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const startCompare = () => {
    if (!compareA || !compareB || compareA === compareB) {
      toast.error("Pick two different sessions");
      return;
    }
    setCompareSessionIds([compareA, compareB]);
    setTab("compare");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden p-0">
        <div className="border-b border-phosphor-green/15 px-5 py-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-phosphor-green">
              <Layers className="h-4 w-4 text-phosphor-cyan" />
              Monitor
            </DialogTitle>
            <DialogDescription className="text-xs text-phosphor-green/45">
              Queue, schedules, channels, and lanes · trusted workspaces only
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeJobs.length > 0 && (
              <Badge variant="amber" className="text-[9px]">
                {activeJobs.length} active
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => void tickSchedules().then((n) => {
                if (n) toast.message(`Fired ${n} schedule(s)`);
                else toast.message("No schedules due");
                void load();
              })}
            >
              <Clock className="h-3.5 w-3.5" />
              Check schedules
            </Button>
            {cwd ? (
              <span className="ml-auto truncate font-mono text-[10px] text-phosphor-green/35">
                {cwd}
              </span>
            ) : (
              <span className="ml-auto text-[10px] text-phosphor-amber/70">
                No workspace — open a repo to queue jobs
              </span>
            )}
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-4 mt-2 h-9 w-auto justify-start self-start">
            <TabsTrigger value="queue" className="gap-1 text-[10px]">
              <Play className="h-3 w-3" />
              Foreground queue
              {activeJobs.length > 0 && (
                <span className="text-phosphor-amber">{activeJobs.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="schedules" className="gap-1 text-[10px]">
              <Clock className="h-3 w-3" />
              Schedules
              {bundle && (
                <span className="text-phosphor-green/40">
                  {bundle.schedules.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="channels" className="gap-1 text-[10px]">
              <Radio className="h-3 w-3" />
              Channels
            </TabsTrigger>
            <TabsTrigger value="lanes" className="gap-1 text-[10px]">
              <Bot className="h-3 w-3" />
              Lanes
              {lanes.length > 0 && (
                <span className="text-phosphor-cyan">{lanes.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-1 text-[10px]">
              <GitCompare className="h-3 w-3" />
              Compare
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
            <TabsContent value="queue" className="mt-3 space-y-3">
              <div className="rounded-lg border border-phosphor-green/15 bg-black/25 p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-phosphor-green/40">
                  <Play className="h-3 w-3" />
                  Queue background task
                </div>
                <p className="mb-2 text-[11px] text-phosphor-green/45">
                  Runs in a separate session so your current workspace stays free.
                  Isolation is on by default (policy still requires a trusted cwd).
                </p>
                <div className="flex flex-col gap-2">
                  <Input
                    value={bgTitle}
                    onChange={(e) => setBgTitle(e.target.value)}
                    placeholder="Title (optional)"
                    className="h-8 text-xs"
                  />
                  <textarea
                    value={bgPrompt}
                    onChange={(e) => setBgPrompt(e.target.value)}
                    placeholder="Prompt for the background agent…"
                    rows={3}
                    className="w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-2 font-mono text-xs text-phosphor-green outline-none placeholder:text-phosphor-green/30 focus:border-phosphor-green/50"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-[11px] text-phosphor-green/60">
                      <Switch
                        checked={bgIsolate}
                        onCheckedChange={setBgIsolate}
                      />
                      Prefer isolation
                    </label>
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={queueNow}
                      disabled={!cwd || !bgPrompt.trim()}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Queue
                    </Button>
                  </div>
                </div>
              </div>

              {activeJobs.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[10px] uppercase tracking-widest text-phosphor-green/40">
                    Active
                  </h3>
                  <div className="space-y-2">
                    {activeJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onOpen={
                          job.sessionId
                            ? () => openSession(job.sessionId!)
                            : undefined
                        }
                        onCancel={() => cancelBackgroundJob(job.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] uppercase tracking-widest text-phosphor-green/40">
                    History
                  </h3>
                  {historyJobs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => clearFinishedJobs()}
                    >
                      Clear finished
                    </Button>
                  )}
                </div>
                {historyJobs.length === 0 ? (
                  <Empty
                    title="No finished jobs yet"
                    body="Queue a background prompt or wait for a schedule to fire."
                  />
                ) : (
                  <div className="space-y-2">
                    {historyJobs.slice(0, 30).map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onOpen={
                          job.sessionId
                            ? () => openSession(job.sessionId!)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>

            <TabsContent value="schedules" className="mt-3 space-y-3">
              <div className="rounded-lg border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-3 py-2 text-[11px] text-phosphor-cyan/80">
                <Shield className="mr-1 inline h-3 w-3" />
                Schedules only run while Spok is open, and only inside trusted
                workspaces. Default isolation keeps main checkouts safer.
              </div>

              <div className="rounded-lg border border-phosphor-green/15 bg-black/25 p-3">
                <div className="mb-2 text-[10px] uppercase tracking-widest text-phosphor-green/40">
                  New schedule
                </div>
                <div className="flex flex-col gap-2">
                  <Input
                    value={schName}
                    onChange={(e) => setSchName(e.target.value)}
                    placeholder="Name (e.g. Nightly health check)"
                    className="h-8 text-xs"
                  />
                  <textarea
                    value={schPrompt}
                    onChange={(e) => setSchPrompt(e.target.value)}
                    placeholder="Prompt to run on each tick…"
                    rows={2}
                    className="w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-2 font-mono text-xs text-phosphor-green outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-phosphor-green/40">Every</span>
                    <Input
                      value={schEvery}
                      onChange={(e) => setSchEvery(e.target.value)}
                      className="h-8 w-16 text-xs"
                    />
                    <select
                      value={schUnit}
                      onChange={(e) =>
                        setSchUnit(e.target.value as ScheduleIntervalUnit)
                      }
                      className="h-8 rounded border border-phosphor-green/25 bg-black/60 px-2 font-mono text-[10px] text-phosphor-green"
                    >
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-[11px] text-phosphor-green/60">
                      <Switch
                        checked={schIsolate}
                        onCheckedChange={setSchIsolate}
                      />
                      Isolate
                    </label>
                    <Button size="sm" className="h-8" onClick={() => void addSchedule()}>
                      <Plus className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  </div>
                </div>
              </div>

              {(bundle?.schedules ?? []).length === 0 ? (
                <Empty
                  title="No schedules yet"
                  body="Create a recurring repo check above."
                />
              ) : (
                <div className="space-y-2">
                  {(bundle?.schedules ?? []).map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      onToggle={async (enabled) => {
                        try {
                          await saveSchedule({ ...s, enabled });
                          void load();
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Update failed"
                          );
                        }
                      }}
                      onDelete={async () => {
                        try {
                          await removeSchedule(s.id);
                          void load();
                          toast.message("Schedule removed");
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Delete failed"
                          );
                        }
                      }}
                      onRunNow={() => {
                        enqueueBackgroundJob({
                          title: `Schedule · ${s.name}`,
                          prompt: s.prompt,
                          cwd: s.cwd,
                          isolate: s.isolate,
                          kind: "scheduled",
                          scheduleId: s.id,
                          priority: 2,
                        });
                        toast.success("Queued from schedule");
                        setTab("queue");
                      }}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="channels" className="mt-3 space-y-3">
              <div className="rounded-lg border border-phosphor-green/15 bg-black/25 p-3 text-[11px] leading-relaxed text-phosphor-green/50">
                Channels accept local webhook events (
                <code className="text-phosphor-cyan/80">
                  POST /api/automation/channels/ingest
                </code>
                ) with a capability token + channel secret. Events become background
                jobs — they never skip workspace trust.
              </div>

              {chSecretShown && (
                <div className="rounded-lg border border-phosphor-amber/30 bg-phosphor-amber/10 p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-widest text-phosphor-amber">
                    Copy secret now — shown once
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-phosphor-green">
                      {chSecretShown}
                    </code>
                    <Button
                      size="sm"
                      className="h-7"
                      onClick={() => {
                        void navigator.clipboard.writeText(chSecretShown);
                        toast.success("Secret copied");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => setChSecretShown(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Input
                  value={chName}
                  onChange={(e) => setChName(e.target.value)}
                  placeholder="Channel name"
                  className="h-8 max-w-xs text-xs"
                />
                <Button size="sm" className="h-8" onClick={() => void addChannel()}>
                  <Plus className="h-3.5 w-3.5" />
                  Create channel
                </Button>
              </div>

              {(bundle?.channels ?? []).length === 0 ? (
                <Empty
                  title="No channels"
                  body="Create a channel to accept external triggers into the queue."
                />
              ) : (
                <div className="space-y-2">
                  {(bundle?.channels ?? []).map((ch) => (
                    <div
                      key={ch.id}
                      className="rounded-lg border border-phosphor-green/15 bg-black/30 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-sm text-phosphor-green">
                              {ch.name}
                            </span>
                            <Badge variant="muted" className="text-[9px]">
                              {ch.targetMode}
                            </Badge>
                            {!ch.enabled && (
                              <Badge variant="error" className="text-[9px]">
                                disabled
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-[9px] text-phosphor-green/35">
                            id={ch.id} · secret {ch.secretPreview || "••••"} ·{" "}
                            {ch.eventCount} events
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-phosphor-green/30">
                            {ch.cwd}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px]"
                          onClick={() => void removeChannel(ch.id).then(() => load())}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(bundle?.recentChannelEvents?.length ?? 0) > 0 && (
                <section>
                  <h3 className="mb-2 text-[10px] uppercase tracking-widest text-phosphor-green/40">
                    Recent events
                  </h3>
                  <div className="space-y-1">
                    {bundle!.recentChannelEvents.slice(0, 10).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-2 rounded border border-phosphor-green/10 px-2 py-1.5 text-[11px]"
                      >
                        <Badge
                          variant={
                            ev.status === "rejected" ? "error" : "muted"
                          }
                          className="text-[8px]"
                        >
                          {ev.status}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-phosphor-green/70">
                          {ev.title || ev.id}
                        </span>
                        <span className="text-[9px] text-phosphor-green/30">
                          {formatRelativeTime(ev.receivedAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="lanes" className="mt-3 space-y-3">
              <p className="text-[11px] text-phosphor-green/45">
                Subagent work is grouped into lanes so the main Thinking feed stays
                readable. Select a lane to inspect; use the merged summary for a
                quick overview.
              </p>
              {!session ? (
                <Empty title="No active session" body="Open a session with subagents." />
              ) : lanes.length === 0 ? (
                <Empty
                  title="No subagent lanes"
                  body="Lanes appear when the agent spawns parallel subagents in this session."
                />
              ) : (
                <>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-phosphor-cyan/20 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-phosphor-cyan/80">
                    {mergeSubagentSummaries(lanes)}
                  </pre>
                  <div className="space-y-2">
                    {lanes.map((lane) => (
                      <button
                        key={lane.id}
                        type="button"
                        onClick={() =>
                          setSelectedSubagentLaneId(
                            selectedSubagentLaneId === lane.id ? null : lane.id
                          )
                        }
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition",
                          selectedSubagentLaneId === lane.id
                            ? "border-phosphor-cyan/40 bg-phosphor-cyan/10"
                            : "border-phosphor-green/15 bg-black/30 hover:border-phosphor-green/30"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Bot className="h-3.5 w-3.5 text-phosphor-cyan/70" />
                          <span className="font-mono text-sm text-phosphor-green">
                            {lane.label}
                          </span>
                          <LaneStatus status={lane.status} />
                          <span className="ml-auto font-mono text-[9px] text-phosphor-green/35">
                            {lane.nodeIds.length} nodes · {lane.toolCallCount} tools
                          </span>
                        </div>
                        {lane.summary && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-phosphor-green/50">
                            {lane.summary}
                          </p>
                        )}
                        {selectedSubagentLaneId === lane.id && session && (
                          <div className="mt-2 max-h-40 space-y-1 overflow-auto border-t border-phosphor-green/10 pt-2">
                            {lane.nodeIds.map((nid) => {
                              const n = session.nodes[nid];
                              if (!n) return null;
                              return (
                                <div
                                  key={nid}
                                  className="font-mono text-[10px] text-phosphor-green/55"
                                >
                                  <span className="text-phosphor-cyan/60">
                                    {n.type}
                                  </span>{" "}
                                  {n.title || n.summary || n.id}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="compare" className="mt-3 space-y-3">
              <p className="text-[11px] text-phosphor-green/45">
                Compare two sessions side by side — metrics, files, and outcome —
                without merging their traces.
              </p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={compareA}
                  onChange={(e) => setCompareA(e.target.value)}
                  className="h-8 min-w-[160px] flex-1 rounded border border-phosphor-green/25 bg-black/60 px-2 font-mono text-[10px] text-phosphor-green"
                >
                  <option value="">Session A…</option>
                  {sessionList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  value={compareB}
                  onChange={(e) => setCompareB(e.target.value)}
                  className="h-8 min-w-[160px] flex-1 rounded border border-phosphor-green/25 bg-black/60 px-2 font-mono text-[10px] text-phosphor-green"
                >
                  <option value="">Session B…</option>
                  {sessionList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" className="h-8" onClick={startCompare}>
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare
                </Button>
              </div>

              {compareSessionIds && (
                <CompareView
                  aId={compareSessionIds[0]}
                  bId={compareSessionIds[1]}
                  onOpen={openSession}
                  onClear={() => setCompareSessionIds(null)}
                />
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function JobCard({
  job,
  onOpen,
  onCancel,
}: {
  job: AutomationJob;
  onOpen?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="rounded-lg border border-phosphor-green/15 bg-black/30 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm text-phosphor-green">
              {job.title}
            </span>
            <JobStatusBadge status={job.status} />
            <Badge variant="muted" className="text-[8px]">
              {job.kind}
            </Badge>
            {job.isolate && (
              <Badge variant="magenta" className="text-[8px]">
                isolated
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-phosphor-green/50">
            {job.summary || job.prompt}
          </p>
          <p className="mt-1 font-mono text-[9px] text-phosphor-green/30">
            {job.cwd}
            {job.startedAt
              ? ` · ${formatRelativeTime(job.startedAt)}`
              : ` · queued ${formatRelativeTime(job.createdAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {onOpen && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              onClick={onOpen}
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </Button>
          )}
          {onCancel && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] text-phosphor-amber"
              onClick={onCancel}
            >
              <Square className="h-3 w-3" />
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleCard({
  schedule,
  onToggle,
  onDelete,
  onRunNow,
}: {
  schedule: ScheduleDefinition;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onRunNow: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-phosphor-green/15 bg-black/30 p-3",
        !schedule.enabled && "opacity-55"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm text-phosphor-green">
              {schedule.name}
            </span>
            <Badge variant="muted" className="text-[9px]">
              every {schedule.every} {schedule.unit}
            </Badge>
            {schedule.lastStatus && (
              <JobStatusBadge
                status={schedule.lastStatus as AutomationJob["status"]}
              />
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-phosphor-green/50">
            {schedule.prompt}
          </p>
          <p className="mt-1 font-mono text-[9px] text-phosphor-green/30">
            next{" "}
            {schedule.nextRunAt
              ? formatRelativeTime(schedule.nextRunAt)
              : "soon"}
            {schedule.lastRunAt
              ? ` · last ${formatRelativeTime(schedule.lastRunAt)}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
          />
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={onRunNow}>
            <Play className="h-3 w-3" />
            Run now
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CompareView({
  aId,
  bId,
  onOpen,
  onClear,
}: {
  aId: string;
  bId: string;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const a = useSpokStore((s) => s.sessions[aId]);
  const b = useSpokStore((s) => s.sessions[bId]);
  if (!a || !b) {
    return (
      <Empty title="Sessions missing" body="One of the sessions was closed." />
    );
  }

  const col = (s: typeof a) => (
    <div className="min-w-0 flex-1 rounded-lg border border-phosphor-green/15 bg-black/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="truncate font-mono text-sm text-phosphor-green">
          {s.name}
        </span>
        <Badge
          variant={
            s.status === "error"
              ? "error"
              : s.status === "running"
                ? "amber"
                : "muted"
          }
          className="text-[9px]"
        >
          {s.status}
        </Badge>
      </div>
      <dl className="space-y-1 font-mono text-[11px] text-phosphor-green/65">
        <Row k="Files" v={String(s.metrics.filesChanged)} />
        <Row k="Tools" v={String(s.metrics.toolCallCount)} />
        <Row k="Thinking" v={String(s.metrics.thinkingSteps)} />
        <Row k="Subagents" v={String(s.metrics.subagentCount)} />
        <Row k="Errors" v={String(s.metrics.errorCount)} />
        <Row
          k="Lines"
          v={`+${s.metrics.linesAdded} / −${s.metrics.linesDeleted}`}
        />
        <Row
          k="cwd"
          v={s.config.cwd.split(/[/\\]/).slice(-2).join("/")}
        />
      </dl>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 h-7 w-full text-[10px]"
        onClick={() => onOpen(s.id)}
      >
        <ExternalLink className="h-3 w-3" />
        Open session
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-phosphor-green/40">
          Side-by-side
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">{col(a)}{col(b)}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-phosphor-green/35">{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </div>
  );
}

function LaneStatus({ status }: { status: string }) {
  if (status === "success")
    return <CheckCircle2 className="h-3.5 w-3.5 text-phosphor-green" />;
  if (status === "error")
    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-phosphor-amber" />;
  if (status === "pending")
    return <Pause className="h-3.5 w-3.5 text-phosphor-green/40" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-phosphor-green/40" />;
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      <p className="empty-state-hint">{body}</p>
      {action}
    </div>
  );
}
