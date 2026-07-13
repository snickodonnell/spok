"use client";

import {
  PanelLeft,
  Command,
  Monitor,
  Play,
  Upload,
  Download,
  Settings,
  Shield,
  ShieldAlert,
  Bell,
  Keyboard,
  Palette,
  Inbox,
} from "lucide-react";
import type { UiTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSpokStore } from "@/lib/store";
import { buildExportPayload } from "@/lib/export-session";
import { toast } from "sonner";
import { unreadCount } from "@/lib/automation/notifications";
import {
  PRODUCT_MODE_META,
  type ProductMode,
} from "@/lib/product-modes";
import {
  buildSessionInbox,
  inboxJobsFingerprint,
  inboxSessionFingerprint,
} from "@/lib/session-inbox";
import { buildEffectivePolicySummary } from "@/lib/security/effective-policy";
import { cn } from "@/lib/utils";

const PRODUCT_MODES: ProductMode[] = [
  "enterprise",
  "run",
  "review",
  "automate",
  "extend",
];

export function Topbar() {
  const sidebarOpen = useSpokStore((s) => s.sidebarOpen);
  const setSidebarOpen = useSpokStore((s) => s.setSidebarOpen);
  const setCommandPaletteOpen = useSpokStore((s) => s.setCommandPaletteOpen);
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setMonitorOpen = useSpokStore((s) => s.setMonitorOpen);
  const setNotificationsOpen = useSpokStore((s) => s.setNotificationsOpen);
  const notifications = useSpokStore((s) => s.notifications);
  const automationJobs = useSpokStore((s) => s.automationJobs);
  const maxConcurrentBackground = useSpokStore(
    (s) => s.automationMaxConcurrent
  );
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const activeGrokFlags = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.grokFlags
      : undefined
  );
  const activeCwd = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.config.cwd
      : undefined
  );
  const effectivePolicy = buildEffectivePolicySummary({
    appPermissionMode,
    flags: {
      alwaysApprove: activeGrokFlags?.alwaysApprove === true,
      permissionMode:
        typeof activeGrokFlags?.permissionMode === "string"
          ? activeGrokFlags.permissionMode
          : undefined,
    },
    cwd: activeCwd,
  });
  const productMode = useSpokStore((s) => s.productMode);
  const setProductMode = useSpokStore((s) => s.setProductMode);
  const unread = unreadCount(notifications);
  const activeJobs = automationJobs.filter((j) =>
    ["queued", "starting", "running", "waiting_approval"].includes(j.status)
  ).length;
  // Lightweight inbox attention badge (same fingerprints as sidebar).
  const sessionListKey = useSpokStore((s) =>
    Object.values(s.sessions)
      .map((sess) => inboxSessionFingerprint(sess))
      .sort()
      .join("|")
  );
  const jobsKey = useSpokStore((s) => inboxJobsFingerprint(s.automationJobs));
  void sessionListKey;
  void jobsKey;
  const inboxSummary = buildSessionInbox(useSpokStore.getState().sessions, {
    jobs: useSpokStore.getState().automationJobs,
    maxConcurrentBackground,
  }).summary;
  const crtEnabled = useSpokStore((s) => s.crtEnabled);
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const uiTheme = useSpokStore((s) => s.uiTheme);
  const setUiTheme = useSpokStore((s) => s.setUiTheme);
  const setKeyboardHelpOpen = useSpokStore((s) => s.setKeyboardHelpOpen);
  const exportActiveSession = useSpokStore((s) => s.exportActiveSession);

  const cycleTheme = () => {
    const order: UiTheme[] = ["professional", "crt", "high-contrast"];
    const i = order.indexOf(uiTheme);
    const next = order[(i + 1) % order.length];
    setUiTheme(next);
    toast.message(
      next === "professional"
        ? "Professional theme"
        : next === "crt"
          ? "CRT phosphor theme"
          : "High contrast theme"
    );
  };

  const exportSession = () => {
    const session = exportActiveSession();
    if (!session) {
      toast.error("No active session");
      return;
    }
    const blob = new Blob(
      [JSON.stringify(buildExportPayload(session), null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spok-session-${session.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-phosphor-green/15 bg-crt-panel px-2">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="font-mono text-xs tracking-[0.2em] text-phosphor-green/75">
          SPOK
        </span>
        <nav
          className="ml-1 flex items-center rounded-md border border-phosphor-green/15 bg-black/25 p-0.5"
          aria-label="Primary destinations"
          data-testid="product-mode-nav"
        >
          {PRODUCT_MODES.map((mode) => {
            const meta = PRODUCT_MODE_META[mode];
            const active = productMode === mode;
            return (
              <button
                key={mode}
                type="button"
                title={meta.description}
                onClick={() => {
                  setProductMode(mode);
                  if (mode === "automate") setMonitorOpen(true);
                }}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-medium transition",
                  active
                    ? "bg-phosphor-green/15 text-phosphor-green"
                    : "text-phosphor-green/45 hover:text-phosphor-green/80"
                )}
                aria-current={active ? "page" : undefined}
              >
                {meta.short}
                {mode === "automate" && activeJobs > 0 && (
                  <span className="ml-1 font-mono text-phosphor-amber">
                    {activeJobs}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {(inboxSummary.attentionCount > 0 ||
          inboxSummary.activeCount > 0 ||
          inboxSummary.readyReviewCount > 0) && (
          <button
            type="button"
            onClick={() => {
              if (!sidebarOpen) setSidebarOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded border border-phosphor-green/20 px-1.5 py-0.5 transition hover:border-phosphor-cyan/40 hover:bg-phosphor-cyan/5"
            title={inboxSummary.headline}
            data-testid="inbox-attention-chip"
          >
            <Inbox className="h-3 w-3 text-phosphor-cyan/80" />
            {inboxSummary.attentionCount > 0 ? (
              <Badge variant="amber" className="h-4 px-1 text-[8px]">
                {inboxSummary.attentionCount} attn
              </Badge>
            ) : inboxSummary.activeCount > 0 ? (
              <Badge variant="default" className="h-4 px-1 text-[8px]">
                {inboxSummary.activeCount} live
              </Badge>
            ) : (
              <Badge variant="cyan" className="h-4 px-1 text-[8px]">
                {inboxSummary.readyReviewCount} review
              </Badge>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "inline-flex max-w-[220px] items-center gap-1 rounded border px-1.5 py-0.5 transition",
            effectivePolicy.elevated
              ? "border-red-500/40 bg-red-500/10 hover:border-red-400/60"
              : "border-phosphor-green/20 hover:border-phosphor-cyan/40 hover:bg-phosphor-cyan/5"
          )}
          title={`${effectivePolicy.headline} — open settings`}
          data-testid="policy-chrome-topbar"
          data-elevated={effectivePolicy.elevated ? "true" : "false"}
          data-risk={effectivePolicy.riskTier}
        >
          {effectivePolicy.elevated ? (
            <ShieldAlert className="h-3 w-3 shrink-0 text-red-400" />
          ) : (
            <Shield className="h-3 w-3 shrink-0 text-phosphor-cyan/80" />
          )}
          <Badge
            variant={
              effectivePolicy.riskTier === "critical" ||
              effectivePolicy.riskTier === "high"
                ? "error"
                : effectivePolicy.riskTier === "medium"
                  ? "amber"
                  : "cyan"
            }
            className="h-4 max-w-[160px] truncate px-1 text-[8px]"
          >
            {effectivePolicy.appLabel} · {effectivePolicy.providerLabel}
          </Badge>
          {effectivePolicy.elevated && (
            <Badge variant="error" className="h-4 px-1 text-[8px]">
              Elevated
            </Badge>
          )}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setLaunchOpen(true)}>
          <Play className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Open repo</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setImportOpen(true)}
          title="Import session"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={exportSession}
          title="Export session"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          onClick={() => setNotificationsOpen(true)}
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-phosphor-cyan px-0.5 text-[8px] font-bold text-black">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setSettingsOpen(true)}
          title="Settings & permissions"
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={cycleTheme}
          title={`Theme: ${uiTheme} (click to cycle)`}
        >
          <Palette className="h-4 w-4 text-phosphor-cyan" />
        </Button>
        {uiTheme === "crt" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setCrtEnabled(!crtEnabled);
              if (crtEnabled) setScanlines(false);
              else setScanlines(true);
            }}
            title="Toggle CRT effects"
          >
            <Monitor
              className={
                crtEnabled ? "h-4 w-4 text-phosphor-green" : "h-4 w-4 opacity-50"
              }
            />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setKeyboardHelpOpen(true)}
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Ctrl+K</span>
        </Button>
      </div>
    </header>
  );
}
