"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Folder,
  GitBranch,
  Shield,
  Terminal,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  FileCode2,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import { localFetch } from "@/lib/local-api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  findLinkedJob,
  projectRunLifecycle,
  type LifecyclePresentationTone,
  type SessionLifecycleProjection,
} from "@/lib/session-lifecycle-projection";
import { buildEffectivePolicySummary } from "@/lib/security/effective-policy";

type CliStatus = {
  command: string;
  found: boolean;
  version: string | null;
};

function lifecycleToneClass(tone: LifecyclePresentationTone): string {
  switch (tone) {
    case "running":
      return "border-phosphor-amber/40 bg-phosphor-amber/8 text-phosphor-amber";
    case "queued":
      return "border-phosphor-cyan/30 bg-phosphor-cyan/5 text-phosphor-cyan/90";
    case "attention":
      return "border-phosphor-amber/45 bg-phosphor-amber/12 text-phosphor-amber";
    case "failed":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    case "review":
      return "border-phosphor-cyan/40 bg-phosphor-cyan/10 text-phosphor-cyan";
    case "finished":
      return "border-phosphor-green/35 bg-phosphor-green/8 text-phosphor-green";
    case "ready":
    default:
      return "border-phosphor-green/25 bg-phosphor-green/5 text-phosphor-green/85";
  }
}

function shortenPath(p: string): string {
  if (!p) return "—";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

/**
 * Unified run header: canonical lifecycle, cwd, branch, permission, CLI,
 * dirty count, queue, stop.
 * Process status stays a distinct layer from lane / review / diagnostic.
 */
export function RunStatusCard({
  onStop,
  queueCount = 0,
}: {
  onStop?: () => void;
  queueCount?: number;
}) {
  const sessionId = useSpokStore((s) => s.activeSessionId);
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!] : undefined
  );
  const status = session?.status;
  const cwd = session?.config.cwd;
  const command = session?.config.command || "grok";
  const gitSummary = session?.gitSummary;
  const filesChanged = useSpokStore((s) => {
    const id = s.activeSessionId;
    if (!id) return 0;
    return Object.keys(s.sessions[id]?.files ?? {}).length;
  });
  const grokFlags = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.grokFlags
      : undefined
  );
  const fileSelected = useSpokStore(
    (s) =>
      !!(
        s.activeSessionId &&
        s.sessions[s.activeSessionId!]?.selectedFileId
      )
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const effectivePolicy = useMemo(
    () =>
      buildEffectivePolicySummary({
        appPermissionMode,
        flags: {
          alwaysApprove: grokFlags?.alwaysApprove === true,
          permissionMode:
            typeof grokFlags?.permissionMode === "string"
              ? grokFlags.permissionMode
              : undefined,
        },
        cwd,
      }),
    [appPermissionMode, grokFlags, cwd]
  );
  const automationJobs = useSpokStore((s) => s.automationJobs);
  const activeJobCount = useSpokStore(
    (s) =>
      s.automationJobs.filter((j) =>
        ["queued", "starting", "running", "waiting_approval"].includes(j.status)
      ).length
  );
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setMonitorSelectedJobId = useSpokStore((s) => s.setMonitorSelectedJobId);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const setCausalDrawerOpen = useSpokStore((s) => s.setCausalDrawerOpen);
  const setViewMode = useSpokStore((s) => s.setViewMode);

  const lifecycle: SessionLifecycleProjection | null = useMemo(() => {
    if (!session) return null;
    const job = findLinkedJob(session.id, automationJobs);
    return projectRunLifecycle(session, job);
  }, [session, automationJobs]);

  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliLoading, setCliLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setCli(null);
      return;
    }
    let cancelled = false;
    setCliLoading(true);
    void localFetch(
      `/api/runtime/cli-status?command=${encodeURIComponent(command)}`
    )
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { status?: CliStatus };
        if (!cancelled && data.status) setCli(data.status);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCliLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, command]);

  if (!sessionId || !status || !lifecycle) return null;

  const isLive = status === "running" || status === "starting";
  const branch = gitSummary?.branch;
  const dirtyCount = gitSummary
    ? gitSummary.stagedCount +
      gitSummary.unstagedCount +
      gitSummary.untrackedCount
    : filesChanged;
  const bgJobs = activeJobCount;

  const runNextAction = () => {
    if (lifecycle.nextAction.kind === "review_changes") {
      setViewMode("diff");
      setWorkspaceRightTab("changes");
      return;
    }
    if (lifecycle.nextAction.kind === "open_job" && lifecycle.jobId) {
      setMonitorSelectedJobId(lifecycle.jobId);
      setMonitorOpen(true);
      return;
    }
    // open_session / default — already on the active session; open workspace.
    setViewMode("workspace");
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-phosphor-green/15 bg-crt-panel/90 px-3 py-2"
      role="region"
      aria-label="Current run"
      data-testid="run-status-card"
      data-lifecycle-lane={lifecycle.lane}
      data-lifecycle-source={lifecycle.reasonSource}
      data-lifecycle-diagnostic={lifecycle.isDiagnostic ? "true" : "false"}
    >
      <Badge
        className={cn(
          "h-6 gap-1.5 border px-2 font-mono text-[10px] uppercase tracking-wider",
          lifecycleToneClass(lifecycle.tone)
        )}
        data-testid="run-lifecycle-badge"
        title={
          lifecycle.isDiagnostic
            ? `Diagnostic · ${lifecycle.reason}`
            : `${lifecycle.laneLabel} · ${lifecycle.reason}`
        }
      >
        {(lifecycle.tone === "running" || isLive) && !lifecycle.isDiagnostic && (
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
        )}
        {lifecycle.badgeLabel}
      </Badge>

      <span
        className={cn(
          "inline-flex min-w-0 max-w-[280px] items-center gap-1 font-mono text-[10px]",
          lifecycle.isDiagnostic ||
            lifecycle.lane === "failed" ||
            lifecycle.lane === "waiting"
            ? "text-phosphor-amber/85"
            : lifecycle.lane === "ready_review"
              ? "text-phosphor-cyan/80"
              : "text-phosphor-green/55"
        )}
        title={`${lifecycle.reasonSource} · ${lifecycle.reason}`}
        data-testid="run-lifecycle-reason"
      >
        <span className="uppercase tracking-wider text-phosphor-green/45">
          {lifecycle.reasonSource}
        </span>
        <span aria-hidden>·</span>
        <span className="truncate">{lifecycle.reason}</span>
      </span>

      {/* Process layer — kept distinct from operational lane / review readiness */}
      {lifecycle.processLabel && (
        <span
          className="hidden items-center gap-1 font-mono text-[10px] text-phosphor-green/40 sm:inline-flex"
          title="Process status (distinct from task outcome / review readiness)"
          data-testid="run-process-layer"
        >
          {lifecycle.processLabel}
          {lifecycle.jobLabel && (
            <>
              <span aria-hidden>·</span>
              <span title="Job status layer">Job {lifecycle.jobLabel}</span>
            </>
          )}
        </span>
      )}

      <span
        className="inline-flex min-w-0 max-w-[220px] items-center gap-1 text-[11px] text-phosphor-green/70"
        title={cwd}
      >
        <Folder className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate font-mono">{shortenPath(cwd || "")}</span>
      </span>

      {branch && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-phosphor-cyan/85"
          title="Git branch"
        >
          <GitBranch className="h-3 w-3" />
          <span className="font-mono">{branch}</span>
        </span>
      )}

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className={cn(
          "inline-flex max-w-[240px] items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition hover:border-phosphor-cyan/50",
          effectivePolicy.elevated
            ? "border-red-500/40 bg-red-500/10 text-red-300"
            : effectivePolicy.riskTier === "medium"
              ? "border-phosphor-amber/40 bg-phosphor-amber/10 text-phosphor-amber"
              : "border-phosphor-green/20 text-phosphor-green/65"
        )}
        title={`${effectivePolicy.headline} — ${effectivePolicy.riskLabel}. Open settings.`}
        data-testid="policy-chrome-run-status"
        data-elevated={effectivePolicy.elevated ? "true" : "false"}
        data-risk={effectivePolicy.riskTier}
      >
        {effectivePolicy.elevated ? (
          <ShieldAlert className="h-3 w-3 shrink-0" />
        ) : (
          <Shield className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate font-mono tracking-wide">
          {effectivePolicy.appLabel} · {effectivePolicy.providerLabel}
        </span>
        {effectivePolicy.elevated && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-red-400">
            elevated
          </span>
        )}
      </button>

      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px]",
          cliLoading
            ? "text-phosphor-green/40"
            : cli?.found
              ? "text-phosphor-green/70"
              : "text-phosphor-amber"
        )}
        title={
          cli?.found
            ? `CLI ready: ${cli.command}${cli.version ? ` ${cli.version}` : ""}`
            : `CLI not found — samples and import still work`
        }
      >
        {cliLoading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : cli?.found ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <AlertCircle className="h-3 w-3" />
        )}
        <Terminal className="h-3 w-3 opacity-70" />
        <span className="font-mono">
          {cliLoading
            ? "cli…"
            : cli?.found
              ? `${cli.command}${cli.version ? `@${cli.version}` : ""}`
              : `${command} missing`}
        </span>
      </span>

      <button
        type="button"
        onClick={() => setWorkspaceRightTab("changes")}
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono",
          dirtyCount > 0
            ? "border-phosphor-amber/35 text-phosphor-amber"
            : "border-phosphor-green/15 text-phosphor-green/45"
        )}
        title="Open Changes"
      >
        <FileCode2 className="h-3 w-3" />
        {dirtyCount} changed
      </button>

      {(queueCount > 0 || bgJobs > 0) && (
        <button
          type="button"
          onClick={() => setMonitorOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-phosphor-amber/30 px-1.5 py-0.5 text-[10px] font-mono text-phosphor-amber"
          title="Open Monitor"
        >
          <Layers className="h-3 w-3" />
          {queueCount > 0 && <span>{queueCount} queued</span>}
          {queueCount > 0 && bgJobs > 0 && <span>·</span>}
          {bgJobs > 0 && <span>{bgJobs} bg</span>}
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[10px] text-phosphor-cyan/90"
          onClick={runNextAction}
          title={`${lifecycle.nextAction.label} (${lifecycle.reasonSource})`}
          data-testid="run-lifecycle-next-action"
        >
          {lifecycle.nextAction.label}
          <ArrowRight className="h-3 w-3" />
        </Button>
        {fileSelected && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px]"
            onClick={() => setCausalDrawerOpen(true)}
            title="Why did this change?"
          >
            Why changed?
          </Button>
        )}
        {isLive && onStop && (
          <Button
            variant="destructive"
            size="sm"
            className="h-7"
            onClick={onStop}
            title="Stop current run"
          >
            <Square className="h-3 w-3" />
            Stop
          </Button>
        )}
        {!isLive && status === "ready" && lifecycle.lane === "idle" && (
          <span className="text-[10px] text-phosphor-green/40">
            Prompt below to run
          </span>
        )}
      </div>
    </div>
  );
}
