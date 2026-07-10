"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  FileCode2,
  FolderOpen,
  Loader2,
  MessageSquare,
  Monitor,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { Toaster } from "sonner";
import { toast } from "sonner";
import { useSpokStore } from "@/lib/store";
import { useSessionHydration } from "@/hooks/use-session-hydration";
import { useMobileSessionLifecycle } from "@/hooks/use-mobile-session-lifecycle";
import { useMobileLiveWatch } from "@/hooks/use-mobile-live-watch";
import { useThemeSync } from "@/hooks/use-theme";
import { useGitWatch } from "@/hooks/use-git-watch";
import { resolveThemeEffects } from "@/lib/theme";
import { PromptComposer } from "@/components/session/prompt-composer";
import { ThinkingStream } from "@/components/trace/thinking-stream";
import { ErrorBoundary } from "@/components/shell/error-boundary";
import { MobileFolderPicker } from "@/components/mobile/mobile-folder-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SAMPLES } from "@/lib/samples";
import { playEvents } from "@/lib/playback";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { LayoutPreference } from "@/lib/mobile-layout";

/** Lazy dialogs — desktop-style launch is secondary; mobile uses full-screen picker */
const ImportDialog = dynamic(
  () => import("@/components/shell/import-dialog").then((m) => m.ImportDialog),
  { ssr: false }
);
const ApprovalOverlay = dynamic(
  () =>
    import("@/components/shell/approval-overlay").then((m) => m.ApprovalOverlay),
  { ssr: false }
);

type MobileTab = "run" | "think" | "files" | "sessions";

type Props = {
  layoutPreference: LayoutPreference;
  onLayoutPreference: (p: LayoutPreference) => void;
};

/**
 * Phone-first shell. Same store / APIs / host PC as desktop — different chrome only.
 * Mounted only when `useMobileLayout().isMobile` is true.
 */
export function MobileShell({ layoutPreference, onLayoutPreference }: Props) {
  // Fast phone boot: few sessions, prefer snapshot over replaying huge event logs
  useSessionHydration({ maxSessions: 3, preferSnapshot: true });
  // Kill host process when phone navigates away / closes tab
  useMobileSessionLifecycle(true);
  // Poll host for live runs + pull thought events (simple refresh)
  const liveWatch = useMobileLiveWatch(true);
  useThemeSync();

  const sessions = useSpokStore((s) => s.sessions);
  const activeSessionId = useSpokStore((s) => s.activeSessionId);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const hydrating = useSpokStore((s) => s.hydrating);
  const hydrated = useSpokStore((s) => s.hydrated);
  const uiTheme = useSpokStore((s) => s.uiTheme);
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const scanlines = useSpokStore((s) => s.scanlines);
  const reducedMotion = useSpokStore((s) => s.reducedMotion);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);
  const setProductMode = useSpokStore((s) => s.setProductMode);

  const session = activeSessionId ? sessions[activeSessionId] : null;

  useGitWatch(
    session?.config.cwd || undefined,
    !!session &&
      !!session.config.cwd &&
      (session.status === "running" || session.status === "starting")
  );

  const [tab, setTab] = useState<MobileTab>("run");
  /** Full-screen folder picker — never blocked by an active session */
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const themeFx = resolveThemeEffects({
    theme: uiTheme,
    crtEnabled,
    scanlines,
    reducedMotion,
  });

  const sessionList = useMemo(
    () => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  const hasSessions = sessionList.length > 0;
  const showWelcome = hydrated && !activeSessionId && !hasSessions;

  const dirtyCount = session
    ? session.gitSummary
      ? session.gitSummary.stagedCount +
        session.gitSummary.unstagedCount +
        session.gitSummary.untrackedCount
      : Object.keys(session.files).length
    : 0;

  // Only trust host process registry for "live" (not sticky local status)
  const isLive = liveWatch.activeLive;

  // Auto-open Thinking when a run becomes live so thoughts are visible
  const wasLive = useRef(false);
  useEffect(() => {
    if (isLive && !wasLive.current) {
      setTab("think");
    }
    wasLive.current = isLive;
  }, [isLive]);

  const playSample = () => {
    const sample = SAMPLES[0];
    if (!sample) return;
    const id = createSession({
      name: sample.meta.name,
      source: "sample",
      status: "running",
    });
    setProductMode("run");
    setTab("think");
    toast.message(`Playing: ${sample.meta.name}`);
    playEvents(
      sample.events,
      (ev) => {
        applyStreamEvent(id, ev);
        if (ev.content)
          appendRawLog(id, `[${ev.type}] ${ev.content.slice(0, 200)}`);
      },
      {
        speed: 1.5,
        onComplete: () => {
          updateSession(id, { status: "completed" });
          toast.success("Sample complete");
        },
      }
    );
  };

  if (hydrating && !hasSessions) {
    return (
      <div
        className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-crt-bg text-phosphor-green/60"
        data-testid="mobile-shell-loading"
      >
        <Loader2 className="h-7 w-7 animate-spin text-phosphor-cyan" />
        <p className="text-sm">Connecting to host…</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-[100dvh] w-screen flex-col overflow-hidden bg-crt-bg text-phosphor-green",
        themeFx.crtEffects && "crt-flicker"
      )}
      data-testid="mobile-shell"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-phosphor-green/15 bg-crt-panel px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-wide">SPOK</div>
          <div className="truncate text-[11px] text-phosphor-green/45">
            {session
              ? session.name
              : "Connected to host PC · phone layout"}
          </div>
        </div>
        {session && (
          <Badge
            variant={
              isLive ? "amber" : session.status === "error" ? "error" : "muted"
            }
            className="shrink-0 capitalize"
          >
            {session.status}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => void liveWatch.refresh()}
          disabled={liveWatch.refreshing}
          title="Refresh host sessions"
        >
          <RefreshCw
            className={cn(
              "h-4 w-4",
              liveWatch.refreshing && "animate-spin"
            )}
          />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-9 shrink-0 gap-1 px-2.5"
          onClick={() => setFolderPickerOpen(true)}
          title="Change folder — starts a new session"
        >
          <FolderOpen className="h-4 w-4" />
          <span className="text-xs">Folder</span>
        </Button>
      </header>

      {/* Active session banner (home / any tab) */}
      {(liveWatch.anyLive || isLive) && (
        <ActiveSessionBanner
          liveCount={liveWatch.liveSessionIds.length || (isLive ? 1 : 0)}
          activeLive={isLive}
          refreshing={liveWatch.refreshing}
          lastRefreshAt={liveWatch.lastRefreshAt}
          onRefresh={() => void liveWatch.refresh()}
          onOpenThinking={() => {
            if (
              liveWatch.liveSessionIds[0] &&
              liveWatch.liveSessionIds[0] !== activeSessionId
            ) {
              setActiveSession(liveWatch.liveSessionIds[0]);
            }
            setTab("think");
          }}
        />
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary name="mobile-main">
          {showWelcome ? (
            <MobileWelcome
              onOpenRepo={() => setFolderPickerOpen(true)}
              onImport={() => setImportOpen(true)}
              onPlaySample={playSample}
              liveWatch={liveWatch}
              onOpenLiveSession={(id) => {
                setActiveSession(id);
                setTab("think");
              }}
            />
          ) : tab === "run" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {!session && (
                  <div className="space-y-3">
                    <p className="text-sm text-phosphor-green/50">
                      Open a folder on the host PC to start a new session.
                    </p>
                    <Button
                      className="min-h-12 w-full"
                      onClick={() => setFolderPickerOpen(true)}
                    >
                      <FolderOpen className="h-4 w-4" />
                      Choose folder
                    </Button>
                  </div>
                )}
                {session && (
                  <>
                    <button
                      type="button"
                      onClick={() => setFolderPickerOpen(true)}
                      className="w-full rounded-xl border border-phosphor-green/15 bg-black/25 p-3 text-left active:bg-phosphor-green/8"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-phosphor-green/45">
                          Host workspace · tap to change
                        </div>
                        <FolderOpen className="h-4 w-4 shrink-0 text-phosphor-cyan" />
                      </div>
                      <div className="mt-0.5 break-all font-mono text-xs text-phosphor-green/80">
                        {session.config.cwd || "—"}
                      </div>
                      {session.gitSummary?.branch && (
                        <div className="mt-1 text-xs text-phosphor-cyan/80">
                          branch · {session.gitSummary.branch}
                        </div>
                      )}
                      {dirtyCount > 0 && (
                        <div className="mt-1 text-xs text-phosphor-amber">
                          {dirtyCount} file{dirtyCount === 1 ? "" : "s"} changed
                        </div>
                      )}
                      {isLive && (
                        <div className="mt-2 text-[11px] text-phosphor-amber">
                          Changing folder stops the current run and starts a new
                          session.
                        </div>
                      )}
                    </button>

                    {/* Live thoughts while prompting (same stream as Thinking tab) */}
                    <div className="overflow-hidden rounded-xl border border-phosphor-green/15 bg-black/20">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between border-b border-phosphor-green/10 px-3 py-2 text-left"
                        onClick={() => setTab("think")}
                      >
                        <span className="text-[11px] font-medium text-phosphor-green/55">
                          {isLive ? "Live thinking" : "Recent thinking"}
                        </span>
                        <span className="text-[10px] text-phosphor-cyan/70">
                          Full screen
                        </span>
                      </button>
                      <ThinkingStream compact />
                    </div>

                    {(session.promptHistory?.length ?? 0) > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-phosphor-green/45">
                          Recent prompts
                        </div>
                        {[...(session.promptHistory ?? [])]
                          .slice(-4)
                          .reverse()
                          .map((t) => (
                            <div
                              key={t.id}
                              className={cn(
                                "rounded-lg border px-3 py-2 text-sm",
                                t.status === "running"
                                  ? "border-phosphor-amber/35 bg-phosphor-amber/5"
                                  : "border-phosphor-green/12 bg-black/20"
                              )}
                            >
                              <div className="line-clamp-2 text-phosphor-green/85">
                                {t.text}
                              </div>
                              <div className="mt-1 text-[10px] capitalize text-phosphor-green/35">
                                {t.status}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              {session && <PromptComposer variant="mobile" />}
            </div>
          ) : tab === "think" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-phosphor-green/10 px-3 py-2">
                <span className="text-[11px] text-phosphor-green/50">
                  {isLive
                    ? "Streaming from host…"
                    : "Thoughts for this session"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-[11px]"
                  onClick={() => void liveWatch.refresh()}
                  disabled={liveWatch.refreshing}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5",
                      liveWatch.refreshing && "animate-spin"
                    )}
                  />
                  Refresh
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ThinkingStream />
              </div>
            </div>
          ) : tab === "files" ? (
            <MobileFiles sessionId={activeSessionId} />
          ) : (
            <MobileSessions
              sessions={sessionList}
              activeId={activeSessionId}
              onSelect={(id) => {
                setActiveSession(id);
                setTab("run");
              }}
              onOpenRepo={() => setFolderPickerOpen(true)}
              onPlaySample={playSample}
              layoutPreference={layoutPreference}
              onLayoutPreference={onLayoutPreference}
            />
          )}
        </ErrorBoundary>
      </main>

      <MobileFolderPicker
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onOpened={() => {
          setTab("run");
          setProductMode("run");
        }}
      />

      {/* Bottom tabs */}
      {!showWelcome && (
        <nav
          className="flex shrink-0 border-t border-phosphor-green/15 bg-crt-panel pb-[env(safe-area-inset-bottom)]"
          aria-label="Mobile navigation"
          data-testid="mobile-tab-bar"
        >
          <TabBtn
            active={tab === "run"}
            onClick={() => setTab("run")}
            icon={MessageSquare}
            label="Prompt"
          />
          <TabBtn
            active={tab === "think"}
            onClick={() => setTab("think")}
            icon={Brain}
            label="Thinking"
            pulse={isLive}
          />
          <TabBtn
            active={tab === "files"}
            onClick={() => setTab("files")}
            icon={FileCode2}
            label="Files"
            badge={dirtyCount > 0 ? dirtyCount : undefined}
          />
          <TabBtn
            active={tab === "sessions"}
            onClick={() => setTab("sessions")}
            icon={FolderOpen}
            label="More"
          />
        </nav>
      )}

      <ImportDialog />
      <ApprovalOverlay />
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          className: "spok-toast",
          style: {
            background: "var(--crt-panel)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-primary)",
          },
        }}
      />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
  pulse,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Brain;
  label: string;
  badge?: number;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition",
        active
          ? "text-phosphor-green"
          : "text-phosphor-green/40 active:text-phosphor-green/70"
      )}
    >
      <Icon className={cn("h-5 w-5", pulse && "text-phosphor-amber")} />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute right-[18%] top-1.5 rounded-full bg-phosphor-amber px-1 text-[9px] font-bold text-black">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

function ActiveSessionBanner({
  liveCount,
  activeLive,
  refreshing,
  lastRefreshAt,
  onRefresh,
  onOpenThinking,
}: {
  liveCount: number;
  activeLive: boolean;
  refreshing: boolean;
  lastRefreshAt: number | null;
  onRefresh: () => void;
  onOpenThinking: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-phosphor-amber/30 bg-phosphor-amber/10 px-3 py-2"
      data-testid="mobile-active-banner"
    >
      <span className="live-dot h-2 w-2 shrink-0 rounded-full bg-phosphor-amber" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onOpenThinking}
      >
        <div className="text-xs font-medium text-phosphor-amber">
          {activeLive
            ? "Session running on host"
            : `${liveCount} live session${liveCount === 1 ? "" : "s"} on host`}
        </div>
        <div className="text-[10px] text-phosphor-amber/70">
          Tap for live thoughts
          {lastRefreshAt
            ? ` · checked ${formatRelativeTime(lastRefreshAt)}`
            : ""}
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-phosphor-amber"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
      >
        <RefreshCw
          className={cn("h-4 w-4", refreshing && "animate-spin")}
        />
      </Button>
    </div>
  );
}

function MobileWelcome({
  onOpenRepo,
  onImport,
  onPlaySample,
  liveWatch,
  onOpenLiveSession,
}: {
  onOpenRepo: () => void;
  onImport: () => void;
  onPlaySample: () => void;
  liveWatch: ReturnType<typeof useMobileLiveWatch>;
  onOpenLiveSession: (id: string) => void;
}) {
  return (
    <div
      className="flex h-full flex-col gap-5 overflow-y-auto p-5"
      data-testid="mobile-welcome"
    >
      <div className="pt-4">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-phosphor-green/45">
          Phone · host PC
        </div>
        <h1 className="text-2xl font-semibold text-phosphor-green">SPOK</h1>
        <p className="mt-2 text-sm leading-relaxed text-phosphor-green/55">
          Prompts and thinking run on the host over Wi‑Fi. Use Refresh to check
          for an active session.
        </p>
      </div>

      {/* Home notification: active session on host */}
      <div className="rounded-xl border border-phosphor-green/15 bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-phosphor-green/55">
            Host activity
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-[11px]"
            onClick={() => void liveWatch.refresh()}
            disabled={liveWatch.refreshing}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                liveWatch.refreshing && "animate-spin"
              )}
            />
            Refresh
          </Button>
        </div>
        {liveWatch.anyLive ? (
          <div className="space-y-2">
            {liveWatch.liveProcesses.map((p) => (
              <button
                key={p.sessionId}
                type="button"
                onClick={() => onOpenLiveSession(p.sessionId)}
                className="flex w-full items-start gap-2 rounded-lg border border-phosphor-amber/35 bg-phosphor-amber/10 px-3 py-2.5 text-left"
              >
                <span className="live-dot mt-1.5 h-2 w-2 shrink-0 rounded-full bg-phosphor-amber" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-phosphor-amber">
                    Active session
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-phosphor-green/50">
                    {p.cwd || p.sessionId}
                  </span>
                  <span className="mt-1 block text-[10px] text-phosphor-cyan/80">
                    Tap to watch thinking
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-phosphor-green/40">
            No live Grok process on the host right now.
            {liveWatch.lastRefreshAt
              ? ` Last checked ${formatRelativeTime(liveWatch.lastRefreshAt)}.`
              : ""}
          </p>
        )}
        {liveWatch.error && (
          <p className="mt-2 text-[11px] text-red-400/90">{liveWatch.error}</p>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <Button className="min-h-12 w-full text-base" onClick={onOpenRepo}>
          <Play className="h-4 w-4" />
          Open repo on host
        </Button>
        <Button
          variant="amber"
          className="min-h-12 w-full text-base"
          onClick={onPlaySample}
        >
          <Sparkles className="h-4 w-4" />
          Play sample
        </Button>
        <Button
          variant="secondary"
          className="min-h-11 w-full"
          onClick={onImport}
        >
          <Upload className="h-4 w-4" />
          Import
        </Button>
      </div>
    </div>
  );
}

function MobileFiles({ sessionId }: { sessionId: string | null }) {
  const session = useSpokStore((s) =>
    sessionId ? s.sessions[sessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const selectedFileId = session?.selectedFileId;

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-phosphor-green/40">
        No session
      </div>
    );
  }

  const files = Object.values(session.files).sort((a, b) =>
    a.path.localeCompare(b.path)
  );

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <FileCode2 className="h-8 w-8 text-phosphor-green/25" />
        <p className="text-sm text-phosphor-green/50">No file changes yet</p>
        <p className="text-xs text-phosphor-green/35">
          They appear here after Grok edits the repo on the host.
        </p>
      </div>
    );
  }

  const selected = selectedFileId ? session.files[selectedFileId] : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {files.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => selectFile(f.id)}
              className={cn(
                "flex w-full items-center gap-2 border-b border-phosphor-green/8 px-3 py-3 text-left active:bg-phosphor-green/8",
                selectedFileId === f.id && "bg-phosphor-green/10"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-phosphor-green/90">
                  {f.path}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-phosphor-green/40">
                  {f.status}
                  {f.staged ? " · staged" : ""}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-phosphor-green">+{f.additions}</span>{" "}
                <span className="text-red-400">-{f.deletions}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-t border-phosphor-green/15 bg-black/40 p-3">
          <div className="mb-1 truncate text-xs font-medium text-phosphor-cyan">
            {selected.path}
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-phosphor-green/65">
            {(selected.newContent || selected.oldContent || "(no preview)")
              .split("\n")
              .slice(0, 40)
              .join("\n")}
            {(selected.newContent || "").split("\n").length > 40
              ? "\n…"
              : ""}
          </pre>
        </div>
      )}
    </div>
  );
}

function MobileSessions({
  sessions,
  activeId,
  onSelect,
  onOpenRepo,
  onPlaySample,
  layoutPreference,
  onLayoutPreference,
}: {
  sessions: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: number;
    config: { cwd: string };
    source: string;
  }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onOpenRepo: () => void;
  onPlaySample: () => void;
  layoutPreference: LayoutPreference;
  onLayoutPreference: (p: LayoutPreference) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-3 pb-6">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" className="min-h-10" onClick={onOpenRepo}>
          <Play className="h-3.5 w-3.5" />
          Open repo
        </Button>
        <Button size="sm" variant="amber" className="min-h-10" onClick={onPlaySample}>
          <Sparkles className="h-3.5 w-3.5" />
          Sample
        </Button>
      </div>

      <h2 className="mb-2 text-[11px] font-medium text-phosphor-green/45">
        Sessions on host
      </h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-phosphor-green/40">No sessions yet</p>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  s.id === activeId
                    ? "border-phosphor-cyan/40 bg-phosphor-cyan/10"
                    : "border-phosphor-green/12 bg-black/25 active:bg-phosphor-green/8"
                )}
              >
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-phosphor-green/40">
                  {s.config.cwd || s.source}
                </div>
                <div className="mt-1 text-[10px] text-phosphor-green/35">
                  {s.status} · {formatRelativeTime(s.updatedAt)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 rounded-xl border border-phosphor-green/12 bg-black/20 p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Monitor className="h-4 w-4 text-phosphor-cyan" />
          Layout
        </div>
        <p className="mb-2 text-[11px] text-phosphor-green/45">
          Phone layout is auto-detected. Force desktop if you prefer the full UI.
        </p>
        <div className="flex gap-1 rounded-lg border border-phosphor-green/15 p-0.5">
          {(
            [
              ["auto", "Auto"],
              ["mobile", "Phone"],
              ["desktop", "Desktop"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onLayoutPreference(value)}
              className={cn(
                "flex-1 rounded-md py-2 text-xs transition",
                layoutPreference === value
                  ? "bg-phosphor-green/15 text-phosphor-green"
                  : "text-phosphor-green/45"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
