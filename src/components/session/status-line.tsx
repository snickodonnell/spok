"use client";

import { useEffect, useState } from "react";
import { useSpokStore } from "@/lib/store";
import { localFetch } from "@/lib/local-api-client";
import { isDesktopRuntime } from "@/lib/desktop";
/** Client-safe shape mirrored from server probe (avoid importing Node cli-status). */
type CliStatus = {
  command: string;
  found: boolean;
  version: string | null;
  versionRaw: string | null;
  probeMs: number;
  platform: string;
  authChecked: false;
  authGuidance: string;
  error?: string;
};
import {
  Folder,
  GitBranch,
  Shield,
  Terminal,
  Monitor,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact status strip under metrics: cwd, branch, permission, CLI readiness, shell mode.
 * CLI readiness is presence/version only — never claims login state.
 */
export function StatusLine() {
  // Only the fields we paint — full session would re-render on every stream tick.
  const hasSession = useSpokStore((s) =>
    !!(s.activeSessionId && s.sessions[s.activeSessionId])
  );
  const command = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.config.command || "grok"
      : "grok"
  );
  const cwd = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.config.cwd : undefined
  );
  const gitBranch = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.gitSummary?.branch
      : undefined
  );
  const hydratePartial = useSpokStore((s) =>
    s.activeSessionId
      ? !!s.sessions[s.activeSessionId!]?.hydratePartial
      : false
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliLoading, setCliLoading] = useState(false);
  const desktop = isDesktopRuntime();

  useEffect(() => {
    if (!hasSession) {
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
      .catch(() => {
        /* optional */
      })
      .finally(() => {
        if (!cancelled) setCliLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-probe when session identity or CLI binary changes (not every store tick)
  }, [hasSession, command]);

  if (!hasSession) return null;

  const branch = gitBranch;
  const cwdShort = shortenPath(cwd || "");

  return (
    <div
      className="flex h-7 items-center gap-2 overflow-x-auto border-b border-phosphor-green/10 bg-crt-panel/80 px-3 text-[10px] text-phosphor-green/55"
      role="status"
      aria-label="Session status"
    >
      <span
        className="inline-flex min-w-0 max-w-[28%] items-center gap-1"
        title={cwd}
      >
        <Folder className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate font-mono text-phosphor-green/70">
          {cwdShort || "—"}
        </span>
      </span>

      {branch && (
        <span
          className="inline-flex items-center gap-1 text-phosphor-cyan/80"
          title="Git branch"
        >
          <GitBranch className="h-3 w-3" />
          <span className="font-mono">{branch}</span>
        </span>
      )}

      <span
        className="inline-flex items-center gap-1"
        title="Permission mode"
      >
        <Shield className="h-3 w-3 text-phosphor-cyan/70" />
        <span className="font-mono uppercase tracking-wider">
          {appPermissionMode}
        </span>
      </span>

      <span
        className={cn(
          "inline-flex items-center gap-1",
          cliLoading
            ? "text-phosphor-green/40"
            : cli?.found
              ? "text-phosphor-green/75"
              : "text-phosphor-amber"
        )}
        title={
          cli?.found
            ? `CLI ready: ${cli.command}${cli.version ? ` ${cli.version}` : ""} (login is managed by native Grok CLI)`
            : cli
              ? `CLI not found: ${cli.command}. Install Grok CLI and authenticate there before live runs.`
              : "Checking Grok CLI…"
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

      {hydratePartial && (
        <span
          className="inline-flex items-center gap-1 text-phosphor-cyan/80"
          title="Loading transcript and changes from disk"
          data-testid="session-body-loading"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="font-mono">loading…</span>
        </span>
      )}

      <span
        className="ml-auto inline-flex items-center gap-1 text-phosphor-green/40"
        title={desktop ? "Desktop shell" : "Browser / local Next"}
      >
        <Monitor className="h-3 w-3" />
        <span className="font-mono uppercase tracking-wider">
          {desktop ? "desktop" : "web"}
        </span>
      </span>
    </div>
  );
}

function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}
