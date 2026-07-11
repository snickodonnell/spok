"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import { localFetch } from "@/lib/local-api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/lib/types";

type CliStatus = {
  command: string;
  found: boolean;
  version: string | null;
};

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "stopped":
      return "Stopped";
    case "paused":
      return "Paused";
    case "ready":
      return "Ready";
    default:
      return status;
  }
}

function statusTone(status: SessionStatus): string {
  switch (status) {
    case "running":
    case "starting":
      return "border-phosphor-amber/40 bg-phosphor-amber/8 text-phosphor-amber";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    case "completed":
      return "border-phosphor-green/35 bg-phosphor-green/8 text-phosphor-green";
    case "stopped":
      return "border-phosphor-green/20 bg-black/30 text-phosphor-green/55";
    default:
      return "border-phosphor-cyan/30 bg-phosphor-cyan/5 text-phosphor-cyan/90";
  }
}

function shortenPath(p: string): string {
  if (!p) return "—";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

/**
 * Unified run header: status, cwd, branch, permission, CLI, dirty count, queue, stop.
 * Answers "what is running and what can I do next?" within a few seconds.
 */
export function RunStatusCard({
  onStop,
  queueCount = 0,
}: {
  onStop?: () => void;
  queueCount?: number;
}) {
  const sessionId = useSpokStore((s) => s.activeSessionId);
  const status = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.status : undefined
  );
  const cwd = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.config.cwd : undefined
  );
  const command = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.config.command || "grok"
      : "grok"
  );
  const gitSummary = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.gitSummary : undefined
  );
  const filesChanged = useSpokStore((s) => {
    const id = s.activeSessionId;
    if (!id) return 0;
    return Object.keys(s.sessions[id]?.files ?? {}).length;
  });
  const alwaysApprove = useSpokStore(
    (s) =>
      s.activeSessionId
        ? s.sessions[s.activeSessionId!]?.grokFlags?.alwaysApprove === true
        : false
  );
  const fileSelected = useSpokStore(
    (s) =>
      !!(
        s.activeSessionId &&
        s.sessions[s.activeSessionId!]?.selectedFileId
      )
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const activeJobCount = useSpokStore(
    (s) =>
      s.automationJobs.filter((j) =>
        ["queued", "running", "waiting_approval"].includes(j.status)
      ).length
  );
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const setCausalDrawerOpen = useSpokStore((s) => s.setCausalDrawerOpen);

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

  if (!sessionId || !status) return null;

  const isLive = status === "running" || status === "starting";
  const branch = gitSummary?.branch;
  const dirtyCount = gitSummary
    ? gitSummary.stagedCount +
      gitSummary.unstagedCount +
      gitSummary.untrackedCount
    : filesChanged;
  const bgJobs = activeJobCount;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-phosphor-green/15 bg-crt-panel/90 px-3 py-2"
      role="region"
      aria-label="Current run"
      data-testid="run-status-card"
    >
      <Badge
        className={cn(
          "h-6 gap-1.5 border px-2 font-mono text-[10px] uppercase tracking-wider",
          statusTone(status)
        )}
      >
        {isLive && (
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
        )}
        {statusLabel(status)}
      </Badge>

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
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition hover:border-phosphor-cyan/50",
          alwaysApprove || appPermissionMode === "bypass"
            ? "border-phosphor-amber/40 bg-phosphor-amber/10 text-phosphor-amber"
            : "border-phosphor-green/20 text-phosphor-green/65"
        )}
        title="Permission mode — open settings"
      >
        {alwaysApprove || appPermissionMode === "bypass" ? (
          <ShieldAlert className="h-3 w-3" />
        ) : (
          <Shield className="h-3 w-3" />
        )}
        <span className="font-mono uppercase tracking-wider">
          {alwaysApprove ? "always approve" : appPermissionMode}
        </span>
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
        {!isLive && status === "ready" && (
          <span className="text-[10px] text-phosphor-green/40">
            Prompt below to run
          </span>
        )}
      </div>
    </div>
  );
}
