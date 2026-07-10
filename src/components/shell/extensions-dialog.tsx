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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useSpokStore } from "@/lib/store";
import {
  fetchExtensions,
  fetchSkillDetail,
  saveExtensionPreferences,
  type ExtensionsResponse,
} from "@/lib/extensions-client";
import type {
  CustomAgentConfig,
  ExtensionTrustState,
  HookDefinition,
  McpServerConfig,
  McpToolDescriptor,
  PluginDescriptor,
  SkillDescriptor,
} from "@/lib/extensions/types";
import { HOOK_EVENT_META } from "@/lib/extensions/types";
import { toast } from "sonner";
import {
  Loader2,
  Puzzle,
  BookOpen,
  Server,
  Webhook,
  Bot,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Product-facing sections: Gallery, Installed, Trust Review, Agents */
type TabId = "gallery" | "installed" | "trust" | "agents";

function TrustBadge({ trust }: { trust: ExtensionTrustState }) {
  const map = {
    trusted: {
      label: "Trusted",
      variant: "cyan" as const,
      icon: ShieldCheck,
    },
    untrusted: {
      label: "Needs review",
      variant: "amber" as const,
      icon: ShieldQuestion,
    },
    pending_review: {
      label: "Pending",
      variant: "amber" as const,
      icon: ShieldAlert,
    },
    denied: {
      label: "Denied",
      variant: "error" as const,
      icon: ShieldX,
    },
  };
  const m = map[trust] ?? map.untrusted;
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className="gap-0.5 text-[9px]">
      <Icon className="h-2.5 w-2.5" />
      {m.label}
    </Badge>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="muted" className="text-[9px] capitalize">
      {source}
    </Badge>
  );
}

function ApprovalBadge({
  approval,
}: {
  approval: McpToolDescriptor["approval"];
}) {
  const label =
    approval === "allow"
      ? "Allow"
      : approval === "ask"
        ? "Ask"
        : approval === "deny"
          ? "Deny"
          : "Untrusted";
  const variant =
    approval === "allow"
      ? ("cyan" as const)
      : approval === "deny"
        ? ("error" as const)
        : ("amber" as const);
  return (
    <Badge variant={variant} className="text-[9px]">
      {label}
    </Badge>
  );
}

export function ExtensionsDialog() {
  const open = useSpokStore((s) => s.extensionsOpen);
  const setOpen = useSpokStore((s) => s.setExtensionsOpen);
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectedSkillIds = useSpokStore((s) => s.selectedSkillIds);
  const toggleSelectedSkill = useSpokStore((s) => s.toggleSelectedSkill);
  const selectedAgentId = useSpokStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useSpokStore((s) => s.setSelectedAgentId);

  const cwd = session?.config.cwd;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ExtensionsResponse | null>(null);
  const [tab, setTab] = useState<TabId>("gallery");
  const [filter, setFilter] = useState("");
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillBody, setSkillBody] = useState<Record<string, string>>({});
  const [layer, setLayer] = useState<"user" | "project">("user");

  // New MCP / hook form state
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [hookName, setHookName] = useState("");
  const [hookMessage, setHookMessage] = useState(
    "Custom hook fired on {{event}}"
  );
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchExtensions(cwd);
      setData(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load extensions");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const q = filter.trim().toLowerCase();

  const skills = useMemo(() => {
    if (!data) return [] as SkillDescriptor[];
    return data.skills.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.id.includes(q)
    );
  }, [data, q]);

  const mcpServers = useMemo(() => {
    if (!data) return [] as McpServerConfig[];
    return data.mcpServers.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.id.includes(q)
    );
  }, [data, q]);

  const hooks = useMemo(() => {
    if (!data) return [] as HookDefinition[];
    return data.hooks.filter(
      (h) => !q || h.name.toLowerCase().includes(q) || h.id.includes(q)
    );
  }, [data, q]);

  const plugins = useMemo(() => {
    if (!data) return [] as PluginDescriptor[];
    return data.plugins.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q)
    );
  }, [data, q]);

  const agents = useMemo(() => {
    if (!data) return [] as CustomAgentConfig[];
    return data.agents.filter(
      (a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q)
    );
  }, [data, q]);

  const savePatch = async (
    preferences: Parameters<typeof saveExtensionPreferences>[0]["preferences"]
  ) => {
    if (layer === "project" && !cwd) {
      toast.error("Open a workspace to save project extensions");
      return;
    }
    setSaving(true);
    try {
      const res = await saveExtensionPreferences({
        layer,
        cwd,
        preferences,
      });
      setData(res);
      toast.success(
        layer === "project" ? "Project extensions updated" : "User extensions updated"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setSkillEnabled = (id: string, enabled: boolean) => {
    void savePatch({ skills: { [id]: enabled } });
  };

  const setTrust = (
    kind: "mcp" | "hooks" | "plugins",
    id: string,
    trust: ExtensionTrustState
  ) => {
    void savePatch({
      [kind]: { [id]: { trust } },
    } as Parameters<typeof saveExtensionPreferences>[0]["preferences"]);
  };

  const setEnabled = (
    kind: "mcp" | "hooks" | "plugins",
    id: string,
    enabled: boolean
  ) => {
    void savePatch({
      [kind]: { [id]: { enabled } },
    } as Parameters<typeof saveExtensionPreferences>[0]["preferences"]);
  };

  const expandSkill = async (skill: SkillDescriptor) => {
    if (expandedSkill === skill.id) {
      setExpandedSkill(null);
      return;
    }
    setExpandedSkill(skill.id);
    if (skillBody[skill.id]) return;
    try {
      const detail = await fetchSkillDetail(skill.id, cwd, true);
      if (detail.body) {
        setSkillBody((m) => ({ ...m, [skill.id]: detail.body! }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load skill body");
    }
  };

  const addUserMcp = () => {
    if (!mcpName.trim() || !mcpCommand.trim()) {
      toast.error("Name and command are required");
      return;
    }
    const id = mcpName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const server: McpServerConfig = {
      id,
      name: mcpName.trim(),
      transport: "stdio",
      command: mcpCommand.trim(),
      args: [],
      enabled: true,
      source: "user",
      trust: "trusted",
      tools: [],
    };
    const existing = data?.preferences.userMcpServers ?? [];
    void savePatch({
      userMcpServers: [...existing.filter((s) => s.id !== id), server],
    });
    setMcpName("");
    setMcpCommand("");
  };

  const removeUserMcp = (id: string) => {
    const existing = data?.preferences.userMcpServers ?? [];
    void savePatch({
      userMcpServers: existing.filter((s) => s.id !== id),
    });
  };

  const addUserHook = () => {
    if (!hookName.trim()) {
      toast.error("Hook name required");
      return;
    }
    const id = `user:${hookName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const hook: HookDefinition = {
      id,
      name: hookName.trim(),
      description: "User-defined trace hook",
      events: ["stop", "session_end"],
      kind: "trace",
      enabled: true,
      source: "user",
      trust: "trusted",
      message: hookMessage.trim() || "Hook {{event}} · {{sessionId}}",
    };
    const existing = data?.preferences.userHooks ?? [];
    void savePatch({
      userHooks: [...existing.filter((h) => h.id !== id), hook],
    });
    setHookName("");
  };

  const removeUserHook = (id: string) => {
    const existing = data?.preferences.userHooks ?? [];
    void savePatch({ userHooks: existing.filter((h) => h.id !== id) });
  };

  const addUserAgent = () => {
    if (!agentName.trim()) {
      toast.error("Agent name required");
      return;
    }
    const id = `user:${agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const agent: CustomAgentConfig = {
      id,
      name: agentName.trim(),
      description: agentDesc.trim() || undefined,
      permissionMode: "manual",
      worktreeIsolation: false,
      source: "user",
      enabled: true,
    };
    const existing = data?.preferences.agents ?? [];
    void savePatch({
      agents: [...existing.filter((a) => a.id !== id), agent],
    });
    setAgentName("");
    setAgentDesc("");
  };

  const removeUserAgent = (id: string) => {
    const existing = data?.preferences.agents ?? [];
    void savePatch({ agents: existing.filter((a) => a.id !== id) });
  };

  const pendingTrustCount =
    (data?.hooks.filter(
      (h) => h.trust === "untrusted" || h.trust === "pending_review"
    ).length ?? 0) +
    (data?.mcpServers.filter(
      (s) => s.trust === "untrusted" || s.trust === "pending_review"
    ).length ?? 0) +
    (data?.plugins.filter(
      (p) => p.trust === "untrusted" || p.trust === "pending_review"
    ).length ?? 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden p-0">
        <div className="border-b border-phosphor-green/15 px-5 py-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-phosphor-green">
              <Puzzle className="h-4 w-4 text-phosphor-cyan" />
              Extensions
            </DialogTitle>
            <DialogDescription className="text-xs text-phosphor-green/45">
              Gallery · installed tools · trust review · agents
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-phosphor-green/20 p-0.5 text-[10px]">
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1",
                  layer === "user"
                    ? "bg-phosphor-green/15 text-phosphor-green"
                    : "text-phosphor-green/50"
                )}
                onClick={() => setLayer("user")}
              >
                User
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1",
                  layer === "project"
                    ? "bg-phosphor-green/15 text-phosphor-green"
                    : "text-phosphor-green/50"
                )}
                onClick={() => setLayer("project")}
                title={cwd ? cwd : "Open a workspace for project layer"}
              >
                Project
              </button>
            </div>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter extensions…"
              className="h-8 max-w-xs border-phosphor-green/20 bg-black/40 text-xs"
            />
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
            {pendingTrustCount > 0 && (
              <Badge variant="amber" className="text-[9px]">
                {pendingTrustCount} need trust review
              </Badge>
            )}
            {saving && (
              <span className="flex items-center gap-1 text-[10px] text-phosphor-cyan/70">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
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
            <TabsTrigger value="gallery" className="gap-1 text-[10px]">
              <BookOpen className="h-3 w-3" />
              Gallery
              {data && (
                <span className="text-phosphor-green/40">
                  {data.skills.length + data.plugins.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="installed" className="gap-1 text-[10px]">
              <Server className="h-3 w-3" />
              Installed
              {data && (
                <span className="text-phosphor-green/40">
                  {data.mcpServers.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="trust" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3" />
              Trust review
              {pendingTrustCount > 0 && (
                <span className="text-phosphor-amber">{pendingTrustCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-1 text-[10px]">
              <Bot className="h-3 w-3" />
              Agents
              {data && (
                <span className="text-phosphor-green/40">{data.agents.length}</span>
              )}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
            {loading && !data ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-phosphor-green/50">
                <Loader2 className="h-6 w-6 animate-spin text-phosphor-cyan" />
                <span className="font-mono text-xs uppercase tracking-widest">
                  Scanning extensions…
                </span>
              </div>
            ) : (
              <>
                <TabsContent value="gallery" className="mt-3 space-y-3">
                  <h3 className="text-[11px] font-medium text-phosphor-green/55">
                    Skills
                  </h3>
                  {skills.length === 0 ? (
                    <div className="empty-state">
                      <p className="empty-state-title">No skills</p>
                      <p className="empty-state-hint">
                        Add .agents/skills/&lt;name&gt;/SKILL.md or ~/.spok/skills
                      </p>
                    </div>
                  ) : (
                    skills.map((skill) => {
                      const attached = selectedSkillIds.includes(skill.id);
                      const openBody = expandedSkill === skill.id;
                      return (
                        <div
                          key={skill.id}
                          className={cn(
                            "rounded-lg border border-phosphor-green/15 bg-black/30 p-3 transition",
                            !skill.enabled && "opacity-50"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              className="mt-0.5 text-phosphor-green/40 hover:text-phosphor-green"
                              onClick={() => void expandSkill(skill)}
                              aria-label={openBody ? "Collapse" : "Expand"}
                            >
                              {openBody ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-sm text-phosphor-green">
                                  {skill.name}
                                </span>
                                <SourceBadge source={skill.source} />
                                {skill.tags?.slice(0, 3).map((t) => (
                                  <Badge
                                    key={t}
                                    variant="muted"
                                    className="text-[8px]"
                                  >
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                              <p className="mt-1 text-[11px] leading-snug text-phosphor-green/55">
                                {skill.description}
                              </p>
                              <p className="mt-1 truncate font-mono text-[9px] text-phosphor-green/30">
                                {skill.path}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              <Switch
                                checked={skill.enabled}
                                onCheckedChange={(v) =>
                                  setSkillEnabled(skill.id, v)
                                }
                                aria-label={`Enable ${skill.name}`}
                              />
                              <Button
                                variant={attached ? "default" : "outline"}
                                size="sm"
                                className="h-7 gap-1 text-[10px]"
                                onClick={() => toggleSelectedSkill(skill.id)}
                                disabled={!skill.enabled}
                              >
                                <Sparkles className="h-3 w-3" />
                                {attached ? "Attached" : "Attach next turn"}
                              </Button>
                            </div>
                          </div>
                          {openBody && (
                            <pre className="mt-3 max-h-48 overflow-auto rounded border border-phosphor-green/10 bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-phosphor-green/70">
                              {skillBody[skill.id] || "Loading…"}
                            </pre>
                          )}
                        </div>
                      );
                    })
                  )}

                  <h3 className="pt-2 text-[11px] font-medium text-phosphor-green/55">
                    Plugins
                  </h3>
                  {plugins.length === 0 ? (
                    <div className="empty-state py-8">
                      <p className="empty-state-title">No plugins</p>
                      <p className="empty-state-hint">
                        Drop spok.plugin.json under ~/.spok/plugins or .spok/plugins
                      </p>
                    </div>
                  ) : (
                    plugins.map((plugin) => (
                      <div
                        key={plugin.id}
                        className="rounded-lg border border-phosphor-green/15 bg-black/30 p-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-phosphor-green">
                                {plugin.name}
                              </span>
                              <Badge variant="muted" className="text-[9px]">
                                v{plugin.version}
                              </Badge>
                              <SourceBadge source={plugin.source} />
                              <TrustBadge trust={plugin.trust} />
                            </div>
                            {plugin.description && (
                              <p className="mt-1 text-[11px] text-phosphor-green/55">
                                {plugin.description}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-phosphor-green/40">
                              <span>{plugin.skillCount} skills</span>
                              <span>{plugin.mcpCount} mcp</span>
                              <span>{plugin.hookCount} hooks</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Switch
                              checked={plugin.enabled}
                              onCheckedChange={(v) =>
                                setEnabled("plugins", plugin.id, v)
                              }
                            />
                            {(plugin.trust === "untrusted" ||
                              plugin.trust === "pending_review") && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-[10px]"
                                  onClick={() =>
                                    setTrust("plugins", plugin.id, "trusted")
                                  }
                                >
                                  <Check className="h-3 w-3" />
                                  Trust
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[10px]"
                                  onClick={() =>
                                    setTrust("plugins", plugin.id, "denied")
                                  }
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="installed" className="mt-3 space-y-3">
                  <div className="rounded-lg border border-phosphor-green/15 bg-black/20 p-3">
                    <div className="mb-2 text-[10px] font-medium text-phosphor-green/45">
                      Add MCP server
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={mcpName}
                        onChange={(e) => setMcpName(e.target.value)}
                        placeholder="Name"
                        className="h-8 max-w-[140px] text-xs"
                      />
                      <Input
                        value={mcpCommand}
                        onChange={(e) => setMcpCommand(e.target.value)}
                        placeholder="Command (e.g. npx)"
                        className="h-8 min-w-[160px] flex-1 text-xs"
                      />
                      <Button size="sm" className="h-8" onClick={addUserMcp}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {mcpServers.length === 0 ? (
                    <EmptyState
                      icon={Server}
                      title="No MCP servers"
                      body="Register a server above, or add .spok/mcp.json in the project."
                    />
                  ) : (
                    mcpServers.map((server) => {
                      const tools =
                        data?.mcpTools.filter((t) => t.serverId === server.id) ??
                        [];
                      return (
                        <div
                          key={server.id}
                          className="rounded-lg border border-phosphor-green/15 bg-black/30 p-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-sm text-phosphor-green">
                                  {server.name}
                                </span>
                                <SourceBadge source={server.source} />
                                <TrustBadge trust={server.trust} />
                                <Badge variant="muted" className="text-[9px]">
                                  {server.transport}
                                </Badge>
                              </div>
                              {server.description && (
                                <p className="mt-1 text-[11px] text-phosphor-green/55">
                                  {server.description}
                                </p>
                              )}
                              <p className="mt-1 font-mono text-[9px] text-phosphor-green/35">
                                {server.command
                                  ? `$ ${server.command} ${(server.args ?? []).join(" ")}`
                                  : server.url || "—"}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <Switch
                                checked={server.enabled}
                                onCheckedChange={(v) =>
                                  setEnabled("mcp", server.id, v)
                                }
                              />
                              {(server.trust === "untrusted" ||
                                server.trust === "pending_review") && (
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-7 text-[10px]"
                                    onClick={() =>
                                      setTrust("mcp", server.id, "trusted")
                                    }
                                  >
                                    <Check className="h-3 w-3" />
                                    Trust
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px]"
                                    onClick={() =>
                                      setTrust("mcp", server.id, "denied")
                                    }
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              )}
                              {server.source === "user" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[10px] text-phosphor-amber"
                                  onClick={() => removeUserMcp(server.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 space-y-1 border-t border-phosphor-green/10 pt-2">
                            <div className="text-[9px] uppercase tracking-widest text-phosphor-green/35">
                              Tools ({tools.length}) · approval before invoke
                            </div>
                            {tools.map((t) => (
                              <div
                                key={`${t.serverId}:${t.name}`}
                                className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px]"
                              >
                                <span className="font-mono text-phosphor-cyan/80">
                                  {t.name}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-phosphor-green/45">
                                  {t.description || t.inputSummary || ""}
                                </span>
                                <ApprovalBadge approval={t.approval} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </TabsContent>

                <TabsContent value="trust" className="mt-3 space-y-3">
                  <p className="text-[11px] leading-relaxed text-phosphor-green/45">
                    Hooks run on session lifecycle events. Project and plugin hooks
                    need trust review before they execute. Trace hooks only add
                    session events — no shell.
                  </p>

                  <div className="rounded-lg border border-phosphor-green/15 bg-black/20 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-widest text-phosphor-green/40">
                      Add stop/end trace hook (user)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={hookName}
                        onChange={(e) => setHookName(e.target.value)}
                        placeholder="Name"
                        className="h-8 max-w-[140px] text-xs"
                      />
                      <Input
                        value={hookMessage}
                        onChange={(e) => setHookMessage(e.target.value)}
                        placeholder="Message template"
                        className="h-8 min-w-[200px] flex-1 text-xs"
                      />
                      <Button size="sm" className="h-8" onClick={addUserHook}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {hooks.length === 0 ? (
                    <EmptyState
                      icon={Webhook}
                      title="No hooks"
                      body="Built-in stop breadcrumb should appear after refresh."
                    />
                  ) : (
                    hooks.map((hook) => (
                      <div
                        key={hook.id}
                        className={cn(
                          "rounded-lg border border-phosphor-green/15 bg-black/30 p-3",
                          !hook.enabled && "opacity-50"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-sm text-phosphor-green">
                                {hook.name}
                              </span>
                              <SourceBadge source={hook.source} />
                              <TrustBadge trust={hook.trust} />
                              <Badge variant="muted" className="text-[9px]">
                                {hook.kind}
                              </Badge>
                            </div>
                            {hook.description && (
                              <p className="mt-1 text-[11px] text-phosphor-green/55">
                                {hook.description}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {hook.events.map((ev) => (
                                <Badge
                                  key={ev}
                                  variant="muted"
                                  className="text-[8px]"
                                  title={HOOK_EVENT_META[ev]?.description}
                                >
                                  {HOOK_EVENT_META[ev]?.label ?? ev}
                                </Badge>
                              ))}
                            </div>
                            {hook.message && (
                              <p className="mt-1 font-mono text-[9px] text-phosphor-green/35">
                                {hook.message}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Switch
                              checked={hook.enabled}
                              onCheckedChange={(v) =>
                                setEnabled("hooks", hook.id, v)
                              }
                            />
                            {(hook.trust === "untrusted" ||
                              hook.trust === "pending_review") && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-[10px]"
                                  onClick={() =>
                                    setTrust("hooks", hook.id, "trusted")
                                  }
                                >
                                  <Check className="h-3 w-3" />
                                  Trust
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[10px]"
                                  onClick={() =>
                                    setTrust("hooks", hook.id, "denied")
                                  }
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                            {hook.source === "user" &&
                              hook.id.startsWith("user:") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-[10px]"
                                  onClick={() => removeUserHook(hook.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="agents" className="mt-3 space-y-3">
                  <div className="rounded-lg border border-phosphor-green/15 bg-black/20 p-3">
                    <div className="mb-2 text-[10px] font-medium text-phosphor-green/45">
                      Create agent preset
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        placeholder="Name"
                        className="h-8 max-w-[140px] text-xs"
                      />
                      <Input
                        value={agentDesc}
                        onChange={(e) => setAgentDesc(e.target.value)}
                        placeholder="Description"
                        className="h-8 min-w-[180px] flex-1 text-xs"
                      />
                      <Button size="sm" className="h-8" onClick={addUserAgent}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {agents.length === 0 ? (
                    <EmptyState
                      icon={Bot}
                      title="No agents"
                      body="Built-in presets should appear after refresh."
                    />
                  ) : (
                    agents.map((agent) => {
                      const selected = selectedAgentId === agent.id;
                      return (
                        <div
                          key={agent.id}
                          className={cn(
                            "rounded-lg border bg-black/30 p-3",
                            selected
                              ? "border-phosphor-cyan/40 shadow-[0_0_20px_rgba(0,255,255,0.08)]"
                              : "border-phosphor-green/15"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-sm text-phosphor-green">
                                  {agent.name}
                                </span>
                                <SourceBadge source={agent.source} />
                                {agent.permissionMode && (
                                  <Badge variant="muted" className="text-[9px]">
                                    {agent.permissionMode}
                                  </Badge>
                                )}
                                {agent.worktreeIsolation && (
                                  <Badge variant="amber" className="text-[9px]">
                                    worktree
                                  </Badge>
                                )}
                              </div>
                              {agent.description && (
                                <p className="mt-1 text-[11px] text-phosphor-green/55">
                                  {agent.description}
                                </p>
                              )}
                              {agent.tools?.length ? (
                                <p className="mt-1 text-[10px] text-phosphor-green/40">
                                  Tools: {agent.tools.join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <Button
                                size="sm"
                                variant={selected ? "default" : "outline"}
                                className="h-7 text-[10px]"
                                onClick={() =>
                                  setSelectedAgentId(selected ? null : agent.id)
                                }
                              >
                                <Bot className="h-3 w-3" />
                                {selected ? "Selected" : "Use next turn"}
                              </Button>
                              {agent.source === "user" &&
                                agent.id.startsWith("user:") && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-[10px]"
                                    onClick={() => removeUserAgent(agent.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </TabsContent>
              </>
            )}
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof BookOpen;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon className="h-7 w-7 text-phosphor-green/25" />
      <div className="empty-state-title">{title}</div>
      <p className="empty-state-hint">{body}</p>
      {action}
    </div>
  );
}
