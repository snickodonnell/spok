"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSpokStore } from "@/lib/store";
import {
  clearAllApprovalGrants,
  fetchSettings,
  revokeApprovalGrant,
  saveSettings,
  type SettingsResponse,
} from "@/lib/settings-client";
import type {
  AppPermissionMode,
  ApprovalGrant,
  SpokSettings,
} from "@/lib/settings/types";
import { PERMISSION_MODE_META } from "@/lib/settings/defaults";
import { toast } from "sonner";
import {
  Loader2,
  Shield,
  Terminal,
  Trash2,
  RefreshCw,
  Save,
  Eye,
  EyeOff,
  Palette,
  Activity,
  Keyboard,
  FolderLock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { THEME_META, UI_THEMES, type UiTheme } from "@/lib/theme";
import {
  listTrustedWorkspaces,
  revokeTrustedWorkspace,
  type TrustedRootDto,
} from "@/lib/local-api-client";

const MODES: AppPermissionMode[] = [
  "manual",
  "plan",
  "acceptEdits",
  "auto",
  "bypass",
];

export function SettingsDialog() {
  const open = useSpokStore((s) => s.settingsOpen);
  const setOpen = useSpokStore((s) => s.setSettingsOpen);
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const setCrtEnabled = useSpokStore((s) => s.setCrtEnabled);
  const setScanlines = useSpokStore((s) => s.setScanlines);
  const setUiTheme = useSpokStore((s) => s.setUiTheme);
  const setReducedMotion = useSpokStore((s) => s.setReducedMotion);
  const setOsNotifications = useSpokStore((s) => s.setOsNotifications);
  const setNativeFolderPicker = useSpokStore((s) => s.setNativeFolderPicker);
  const setAutomationMaxConcurrent = useSpokStore(
    (s) => s.setAutomationMaxConcurrent
  );
  const setDiagnosticsOpen = useSpokStore((s) => s.setDiagnosticsOpen);
  const setKeyboardHelpOpen = useSpokStore((s) => s.setKeyboardHelpOpen);
  const setAppPermissionMode = useSpokStore((s) => s.setAppPermissionMode);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<SpokSettings | null>(null);
  const [layer, setLayer] = useState<"user" | "project">("user");
  const [grants, setGrants] = useState<ApprovalGrant[]>([]);
  const [trustedRoots, setTrustedRoots] = useState<TrustedRootDto[]>([]);
  const [revokingRoot, setRevokingRoot] = useState<string | null>(null);
  const [section, setSection] = useState<
    "permissions" | "commands" | "appearance" | "grants" | "privacy"
  >("permissions");

  const cwd = session?.config.cwd;

  const loadTrusted = useCallback(async () => {
    try {
      const res = await listTrustedWorkspaces();
      setTrustedRoots(res.roots);
    } catch {
      setTrustedRoots([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchSettings(cwd);
      setData(res);
      setDraft({ ...res.resolved });
      setGrants(res.grants ?? []);
      setAppPermissionMode(res.resolved.permissionMode);
      setAutomationMaxConcurrent(res.resolved.maxConcurrentBackground);
      await loadTrusted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [
    cwd,
    setAppPermissionMode,
    setAutomationMaxConcurrent,
    loadTrusted,
  ]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const patch = (partial: Partial<SpokSettings>) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            ...partial,
            ui: { ...d.ui, ...(partial.ui ?? {}) },
            desktop: { ...d.desktop, ...(partial.desktop ?? {}) },
          }
        : d
    );
  };

  const save = async () => {
    if (!draft) return;
    if (layer === "project" && !cwd) {
      toast.error("Open a workspace to save project settings");
      return;
    }
    setSaving(true);
    try {
      const res = await saveSettings({
        layer,
        cwd,
        settings: {
          permissionMode: draft.permissionMode,
          allowCustomCommands: draft.allowCustomCommands,
          autoProfiles: draft.autoProfiles,
          browseRestrictedToTrusted: draft.browseRestrictedToTrusted,
          showHiddenFolders: draft.showHiddenFolders,
          auditPrivilegedActions: draft.auditPrivilegedActions,
          ui: draft.ui,
          desktop: draft.desktop,
          rules: draft.rules,
        },
      });
      setData(res);
      setDraft({ ...res.resolved });
      setGrants(res.grants ?? []);
      setAppPermissionMode(res.resolved.permissionMode);
      applyUiFromResolved(res.resolved);
      toast.success(
        layer === "project" ? "Project settings saved" : "User settings saved"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetUser = async () => {
    setSaving(true);
    try {
      const res = await saveSettings({ layer: "user", settings: {}, reset: true });
      setData(res);
      setDraft({ ...res.resolved });
      setAppPermissionMode(res.resolved.permissionMode);
      applyUiFromResolved(res.resolved);
      toast.success("User settings reset to defaults");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  const applyUiFromResolved = (resolved: SpokSettings) => {
    setUiTheme(resolved.ui.theme);
    setCrtEnabled(resolved.ui.crtEnabled);
    setScanlines(resolved.ui.scanlines);
    setReducedMotion(resolved.ui.reducedMotion);
    setOsNotifications(
      resolved.ui.osNotifications ?? resolved.desktop.osNotifications
    );
    setNativeFolderPicker(resolved.desktop.nativeFolderPicker);
    setAutomationMaxConcurrent(resolved.maxConcurrentBackground);
  };

  const setTheme = (theme: UiTheme) => {
    const meta = THEME_META[theme];
    patch({
      ui: {
        ...draft!.ui,
        theme,
        crtEnabled: meta.defaultCrt,
        scanlines: meta.defaultScanlines,
      },
    });
    // Live preview while drafting
    setUiTheme(theme);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="border-b border-phosphor-green/15 px-5 py-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-phosphor-cyan" />
              Settings
            </DialogTitle>
            <DialogDescription className="text-xs">
              User and project preferences. Deny rules always win.
            </DialogDescription>
          </DialogHeader>
        </div>

        {loading || !draft ? (
          <div className="flex h-64 items-center justify-center gap-2 text-phosphor-green/50">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading settings…
          </div>
        ) : (
          <Tabs
            value={section}
            onValueChange={(v) =>
              setSection(
                v as
                  | "permissions"
                  | "commands"
                  | "appearance"
                  | "grants"
                  | "privacy"
              )
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1">
              <nav
                className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-phosphor-green/10 bg-black/20 p-2"
                aria-label="Settings sections"
              >
                <TabsList className="flex h-auto w-full flex-col gap-0.5 bg-transparent p-0">
                  {(
                    [
                      ["permissions", "Permissions"],
                      ["commands", "Commands"],
                      ["appearance", "Appearance"],
                      ["grants", "Grants"],
                      ["privacy", "Privacy"],
                    ] as const
                  ).map(([value, label]) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="h-8 w-full justify-start px-2 text-[11px] data-[state=active]:bg-phosphor-green/10"
                    >
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </nav>

            <ScrollArea className="h-[min(56vh,460px)] flex-1 px-4 py-3">
              <TabsContent value="permissions" className="mt-0 space-y-3">
                <LayerPicker layer={layer} setLayer={setLayer} hasProject={!!cwd} />

                <section>
                  <h3 className="mb-2 text-[11px] font-medium text-phosphor-green/55">
                    Permission mode
                    {data?.provenance.permissionMode && (
                      <Badge variant="muted" className="ml-2 normal-case">
                        {data.provenance.permissionMode}
                      </Badge>
                    )}
                  </h3>
                  <div className="grid gap-2">
                    {MODES.map((mode) => {
                      const meta = PERMISSION_MODE_META[mode];
                      const active = draft.permissionMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => patch({ permissionMode: mode })}
                          className={cn(
                            "rounded-lg border px-3 py-2.5 text-left transition",
                            active
                              ? "border-phosphor-green/50 bg-phosphor-green/10"
                              : "border-phosphor-green/15 bg-black/30 hover:border-phosphor-green/30"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-phosphor-green">
                              {meta.label}
                            </span>
                            <Badge
                              variant={
                                mode === "bypass"
                                  ? "error"
                                  : mode === "manual" || mode === "plan"
                                    ? "cyan"
                                    : "amber"
                              }
                            >
                              {meta.risk}
                            </Badge>
                            {active && (
                              <Badge variant="success" className="ml-auto">
                                active
                              </Badge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <ToggleRow
                  label="Allow custom commands"
                  description="Unknown binaries need approval when off."
                  checked={draft.allowCustomCommands}
                  onChange={(v) => patch({ allowCustomCommands: v })}
                />
              </TabsContent>

              <TabsContent value="commands" className="mt-0 space-y-3">
                <p className="text-[11px] text-phosphor-green/45">
                  Auto mode only auto-runs checked profiles.
                </p>
                <div className="space-y-2">
                  {(data?.profiles ?? []).map((p) => {
                    const inAuto = draft.autoProfiles.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-phosphor-green/15 bg-black/30 px-3 py-2.5 hover:border-phosphor-green/30"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 accent-emerald-500"
                          checked={inAuto}
                          disabled={p.id === "custom"}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...new Set([...draft.autoProfiles, p.id])]
                              : draft.autoProfiles.filter((x) => x !== p.id);
                            patch({ autoProfiles: next });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Terminal className="h-3 w-3 text-phosphor-cyan" />
                            <span className="font-mono text-xs text-phosphor-green">
                              {p.name}
                            </span>
                            <Badge variant="muted">{p.id}</Badge>
                            <Badge
                              variant={
                                p.risk === "critical" || p.risk === "high"
                                  ? "error"
                                  : p.risk === "medium"
                                    ? "amber"
                                    : "cyan"
                              }
                            >
                              {p.risk}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11px] text-phosphor-green/45">
                            {p.description}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-phosphor-green/30">
                            {p.binaries.slice(0, 8).join(", ")}
                            {p.binaries.length > 8 ? "…" : ""}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <section>
                  <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-phosphor-green/45">
                    Active rules ({draft.rules.filter((r) => r.enabled !== false).length})
                  </h3>
                  <div className="space-y-1.5">
                    {draft.rules.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-start gap-2 rounded border border-phosphor-green/10 bg-black/20 px-2 py-1.5 text-[11px]"
                      >
                        <Badge
                          variant={
                            r.effect === "deny"
                              ? "error"
                              : r.effect === "allow"
                                ? "success"
                                : "amber"
                          }
                        >
                          {r.effect}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-phosphor-green/80">
                            {r.label || r.id}
                          </div>
                          <div className="text-phosphor-green/40">
                            {r.actions.join(", ")}
                            {r.profile ? ` · profile:${r.profile}` : ""}
                            {r.command ? ` · cmd:${r.command}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="grants" className="mt-0 space-y-3">
                {grants.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-title">No approval grants</p>
                    <p className="empty-state-hint">
                      Allow-always decisions appear here for revoke.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {grants.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center gap-2 rounded border border-phosphor-green/15 bg-black/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs text-phosphor-green">
                            {g.command || g.profile || g.action}
                          </div>
                          <div className="truncate font-mono text-[10px] text-phosphor-green/35">
                            {g.action} · {g.decision}
                            {g.cwd ? ` · ${g.cwd}` : ""}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Revoke grant"
                          onClick={async () => {
                            await revokeApprovalGrant(g.id);
                            setGrants((prev) => prev.filter((x) => x.id !== g.id));
                            toast.message("Grant revoked");
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {grants.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await clearAllApprovalGrants();
                      setGrants([]);
                      toast.message("All grants cleared");
                    }}
                  >
                    Clear all grants
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="appearance" className="mt-0 space-y-4">
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-phosphor-green/45">
                    <Palette className="h-3 w-3" />
                    Theme
                  </h3>
                  <div className="grid gap-2">
                    {UI_THEMES.map((theme) => {
                      const meta = THEME_META[theme];
                      const active = draft.ui.theme === theme;
                      return (
                        <button
                          key={theme}
                          type="button"
                          onClick={() => setTheme(theme)}
                          className={cn(
                            "rounded-lg border px-3 py-2.5 text-left transition",
                            active
                              ? "border-phosphor-cyan/50 bg-phosphor-cyan/10"
                              : "border-phosphor-green/15 bg-black/30 hover:border-phosphor-green/30"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-phosphor-green">
                              {meta.label}
                            </span>
                            {active && (
                              <Badge variant="success" className="ml-auto">
                                active
                              </Badge>
                            )}
                            {theme === "professional" && !active && (
                              <Badge variant="muted" className="ml-auto">
                                recommended
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-phosphor-green/50">
                            {meta.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {draft.ui.theme === "crt" && (
                  <>
                    <ToggleRow
                      label="CRT visual effects"
                      description="Phosphor glow and subtle flicker."
                      checked={draft.ui.crtEnabled}
                      onChange={(v) => {
                        patch({
                          ui: {
                            ...draft.ui,
                            crtEnabled: v,
                            scanlines: v ? draft.ui.scanlines : false,
                          },
                        });
                        setCrtEnabled(v);
                        if (!v) setScanlines(false);
                      }}
                    />
                    <ToggleRow
                      label="Scanlines"
                      description="Requires CRT effects."
                      checked={draft.ui.scanlines}
                      onChange={(v) => {
                        patch({ ui: { ...draft.ui, scanlines: v } });
                        setScanlines(v);
                      }}
                    />
                  </>
                )}

                <ToggleRow
                  label="Reduced motion"
                  description="Disable animations and CRT motion. Also honors OS prefers-reduced-motion."
                  checked={draft.ui.reducedMotion}
                  onChange={(v) => {
                    patch({ ui: { ...draft.ui, reducedMotion: v } });
                    setReducedMotion(v);
                  }}
                />

                <ToggleRow
                  label="Usage meter"
                  description="Show context (and turns) usage in the metrics strip with color that shifts near the limit."
                  checked={draft.ui.showUsageMeter !== false}
                  onChange={(v) =>
                    patch({ ui: { ...draft.ui, showUsageMeter: v } })
                  }
                />

                <label className="block rounded-lg border border-phosphor-green/15 bg-black/30 px-3 py-2.5">
                  <span className="text-xs text-phosphor-green">
                    Context limit (tokens)
                  </span>
                  <p className="mt-0.5 text-[11px] text-phosphor-green/45">
                    Budget for the usage meter. Override with SPOK_CONTEXT_LIMIT
                    env if managed. Default 128000.
                  </p>
                  <input
                    type="number"
                    min={1000}
                    max={2000000}
                    step={1000}
                    className="mt-2 w-full rounded border border-phosphor-green/25 bg-black/50 px-2 py-1.5 font-mono text-xs text-phosphor-green outline-none focus:border-phosphor-cyan/50"
                    value={draft.ui.contextLimitTokens ?? 128000}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!Number.isFinite(n)) return;
                      patch({
                        ui: {
                          ...draft.ui,
                          contextLimitTokens: Math.max(
                            1000,
                            Math.min(2_000_000, n)
                          ),
                        },
                      });
                    }}
                  />
                </label>

                <ToggleRow
                  label="OS notifications"
                  description="Mirror completion, failure, and approval alerts to the desktop shell when available."
                  checked={
                    draft.ui.osNotifications ?? draft.desktop.osNotifications
                  }
                  onChange={(v) => {
                    patch({
                      ui: { ...draft.ui, osNotifications: v },
                      desktop: { ...draft.desktop, osNotifications: v },
                    });
                    setOsNotifications(v);
                  }}
                />

                <ToggleRow
                  label="Native folder picker"
                  description="Prefer the OS folder dialog in desktop builds. Falls back to the in-app browser."
                  checked={draft.desktop.nativeFolderPicker}
                  onChange={(v) => {
                    patch({
                      desktop: { ...draft.desktop, nativeFolderPicker: v },
                    });
                    setNativeFolderPicker(v);
                  }}
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      setDiagnosticsOpen(true);
                    }}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Diagnostics
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpen(false);
                      setKeyboardHelpOpen(true);
                    }}
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    Keyboard shortcuts
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="privacy" className="mt-0 space-y-3">
                <ToggleRow
                  label="Restrict browse to trusted roots"
                  description="After you open a repo, the file picker only walks trusted workspaces."
                  checked={draft.browseRestrictedToTrusted}
                  onChange={(v) => patch({ browseRestrictedToTrusted: v })}
                />
                <ToggleRow
                  label="Show hidden folders"
                  description="Include dotfolders when browsing the filesystem."
                  checked={draft.showHiddenFolders}
                  onChange={(v) => patch({ showHiddenFolders: v })}
                  icon={draft.showHiddenFolders ? Eye : EyeOff}
                />
                <ToggleRow
                  label="Audit privileged actions"
                  description="Write spawn/approval decisions to ~/.spok/audit.ndjson and the session log."
                  checked={draft.auditPrivilegedActions}
                  onChange={(v) => patch({ auditPrivilegedActions: v })}
                />

                <div
                  className="rounded border border-phosphor-green/15 bg-black/20 p-3"
                  data-testid="trusted-roots-panel"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <FolderLock className="h-3.5 w-3.5 text-phosphor-green/70" />
                      <span className="font-mono text-[11px] uppercase tracking-wider text-phosphor-green/80">
                        Trusted workspaces
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px]"
                      onClick={() => void loadTrusted()}
                      disabled={loading}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Refresh
                    </Button>
                  </div>
                  <p className="mb-2 text-[10px] text-phosphor-green/40">
                    Durable under{" "}
                    <code className="text-phosphor-green/55">
                      ~/.spok/workspace-trust.json
                    </code>
                    . Spawn, Git write, and browse policy use these roots across
                    restarts. Revoke anytime.
                  </p>
                  {trustedRoots.length === 0 ? (
                    <p className="text-[10px] text-phosphor-green/35">
                      No trusted roots yet. Open a workspace from the launch
                      dialog to trust it.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {trustedRoots.map((root) => (
                        <li
                          key={root.path}
                          className="flex items-start gap-2 rounded border border-phosphor-green/10 bg-black/30 px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[10px] text-phosphor-green/85">
                              {root.path}
                            </div>
                            {root.trustedAt > 0 && (
                              <div className="mt-0.5 text-[9px] text-phosphor-green/35">
                                Trusted{" "}
                                {new Date(root.trustedAt).toLocaleString()}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 px-1.5 text-[10px] text-red-400/90 hover:text-red-300"
                            disabled={revokingRoot === root.path}
                            onClick={async () => {
                              setRevokingRoot(root.path);
                              try {
                                await revokeTrustedWorkspace(root.path);
                                toast.success("Workspace trust revoked");
                                await loadTrusted();
                              } catch (e) {
                                toast.error(
                                  e instanceof Error
                                    ? e.message
                                    : "Failed to revoke trust"
                                );
                              } finally {
                                setRevokingRoot(null);
                              }
                            }}
                          >
                            {revokingRoot === root.path ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            Revoke
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            </ScrollArea>
            </div>

            <DialogFooter className="gap-2 border-t border-phosphor-green/15 px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void load()}
                disabled={loading || saving}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reload
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void resetUser()}
                disabled={saving}
              >
                Reset user
              </Button>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save {layer}
              </Button>
            </DialogFooter>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LayerPicker({
  layer,
  setLayer,
  hasProject,
}: {
  layer: "user" | "project";
  setLayer: (l: "user" | "project") => void;
  hasProject: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded border border-phosphor-green/15 bg-black/20 p-1">
      <button
        type="button"
        onClick={() => setLayer("user")}
        className={cn(
          "flex-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
          layer === "user"
            ? "bg-phosphor-green/15 text-phosphor-green"
            : "text-phosphor-green/45"
        )}
      >
        User ~/.spok
      </button>
      <button
        type="button"
        onClick={() => hasProject && setLayer("project")}
        disabled={!hasProject}
        className={cn(
          "flex-1 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
          layer === "project"
            ? "bg-phosphor-cyan/15 text-phosphor-cyan"
            : "text-phosphor-green/45",
          !hasProject && "opacity-40"
        )}
        title={hasProject ? "Project .spok/settings.json" : "Open a repo first"}
      >
        Project .spok/
      </button>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: typeof Eye;
}) {
  return (
    <label className="pref-row cursor-pointer hover:border-phosphor-green/30">
      <span className="min-w-0 flex-1">
        <span className="pref-row-label flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 opacity-60" />}
          {label}
        </span>
        <span className="pref-row-hint">{description}</span>
      </span>
      <input
        type="checkbox"
        className="mt-0.5 shrink-0 accent-emerald-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
