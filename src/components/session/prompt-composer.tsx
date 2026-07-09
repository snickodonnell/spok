"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { nanoid } from "nanoid";
import {
  CornerDownLeft,
  Loader2,
  Square,
  Terminal,
  Slash,
  Puzzle,
  Sparkles,
  Bot,
  X,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSpokStore } from "@/lib/store";
import { runHarness } from "@/lib/harness";
import {
  defaultGrokFlags,
  filterSlashCommands,
  permissionModeLabel,
  resolveRun,
  type GrokRunFlags,
  type SlashCommand,
} from "@/lib/grok-commands";
import { localFetch } from "@/lib/local-api-client";
import { buildExportPayload } from "@/lib/export-session";
import {
  applyHookResultsToSession,
  fetchExtensions,
  runSessionHooks,
} from "@/lib/extensions-client";
import {
  buildSkillAttachmentSnippet,
  buildAgentBrief,
} from "@/lib/extensions/format";
import type { CustomAgentConfig, SkillDescriptor } from "@/lib/extensions/types";
import { enqueueBackgroundJob } from "@/lib/background-runner";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function flagsFromSession(raw?: Record<string, unknown>): GrokRunFlags {
  const d = defaultGrokFlags();
  if (!raw) return d;
  return {
    ...d,
    ...raw,
    // only true when explicitly set — safer default than treating missing as true
    alwaysApprove: raw.alwaysApprove === true,
    noPlan: !!raw.noPlan,
    noSubagents: !!raw.noSubagents,
    noMemory: !!raw.noMemory,
    debug: !!raw.debug,
    check: !!raw.check,
    continueSession: !!raw.continueSession,
  } as GrokRunFlags;
}

export function PromptComposer() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const pushPromptTurn = useSpokStore((s) => s.pushPromptTurn);
  const updatePromptTurn = useSpokStore((s) => s.updatePromptTurn);
  const clearSessionTraces = useSpokStore((s) => s.clearSessionTraces);
  const setGrokFlags = useSpokStore((s) => s.setGrokFlags);
  const exportActiveSession = useSpokStore((s) => s.exportActiveSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);
  const setSettingsOpen = useSpokStore((s) => s.setSettingsOpen);
  const setExtensionsOpen = useSpokStore((s) => s.setExtensionsOpen);
  const selectedSkillIds = useSpokStore((s) => s.selectedSkillIds);
  const toggleSelectedSkill = useSpokStore((s) => s.toggleSelectedSkill);
  const clearSelectedSkills = useSpokStore((s) => s.clearSelectedSkills);
  const selectedAgentId = useSpokStore((s) => s.selectedAgentId);
  const setSelectedAgentId = useSpokStore((s) => s.setSelectedAgentId);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  /** Follow-up prompts queued while a run is active (Phase 7). */
  const [promptQueue, setPromptQueue] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [skillCatalog, setSkillCatalog] = useState<SkillDescriptor[]>([]);
  const [agentCatalog, setAgentCatalog] = useState<CustomAgentConfig[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const queueDrainRef = useRef(false);

  const flags = useMemo(
    () => flagsFromSession(session?.grokFlags),
    [session?.grokFlags]
  );

  // Detect `/` autocomplete query (from start of line or only content)
  const slashQuery = useMemo(() => {
    const t = value;
    if (!t.startsWith("/")) return null;
    // only while still typing the command token
    const after = t.slice(1);
    if (after.includes(" ") || after.includes("\n")) return null;
    return after;
  }, [value]);

  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [] as SlashCommand[];
    return filterSlashCommands(slashQuery).slice(0, 12);
  }, [slashQuery]);

  useEffect(() => {
    setSlashOpen(slashQuery !== null && slashMatches.length > 0);
    setSlashIdx(0);
  }, [slashQuery, slashMatches.length]);

  // Lightweight extension catalog for chip labels (not full bodies)
  useEffect(() => {
    if (!session?.config.cwd) return;
    let cancelled = false;
    void fetchExtensions(session.config.cwd)
      .then((bundle) => {
        if (cancelled) return;
        setSkillCatalog(bundle.skills.filter((s) => s.enabled));
        setAgentCatalog(bundle.agents);
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, [session?.config.cwd, session?.id]);

  const attachedSkills = useMemo(
    () => skillCatalog.filter((s) => selectedSkillIds.includes(s.id)),
    [skillCatalog, selectedSkillIds]
  );
  const selectedAgent = useMemo(
    () => agentCatalog.find((a) => a.id === selectedAgentId) ?? null,
    [agentCatalog, selectedAgentId]
  );

  const applySlash = useCallback(
    (cmd: SlashCommand) => {
      const next = `/${cmd.name}${cmd.argsHint ? " " : ""}`;
      setValue(next);
      setSlashOpen(false);
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        const pos = next.length;
        el.setSelectionRange(pos, pos);
      });
    },
    []
  );

  const stopRun = useCallback(async () => {
    abortRef.current?.abort();
    // Drop queued follow-ups on stop so they do not surprise-run after cancel
    setPromptQueue([]);
    queueDrainRef.current = false;
    if (session) {
      await localFetch(
        `/api/session/start?sessionId=${encodeURIComponent(session.id)}`,
        { method: "DELETE" }
      ).catch(() => undefined);
    }
    busyRef.current = false;
    setBusy(false);
  }, [session]);

  /** Execute one prompt turn (must not be called while busyRef is true). */
  const runPromptText = useCallback(
    async (text: string) => {
      if (!session) return;
      const resolved = resolveRun(text, flags);

      if (resolved.type === "ui") {
        if (resolved.action === "set-flag" && resolved.flags) {
          setGrokFlags(session.id, resolved.flags as Record<string, unknown>);
          setHint(resolved.message ?? "Flag updated");
          toast.message(resolved.message ?? "Flag updated");
          return;
        }
        if (resolved.action === "show-help" || resolved.action === "help") {
          setHint(resolved.message ?? null);
          applyStreamEvent(session.id, {
            type: "system",
            timestamp: Date.now(),
            title: "Help",
            content: resolved.message ?? "Type / to browse commands",
            status: "success",
          });
          return;
        }
        if (resolved.action === "clear") {
          clearSessionTraces(session.id);
          applyStreamEvent(session.id, {
            type: "system",
            timestamp: Date.now(),
            title: "Workspace cleared",
            content: `Repo: ${session.config.cwd}`,
            status: "success",
          });
          toast.success("Traces cleared");
          return;
        }
        if (resolved.action === "stop") {
          await stopRun();
          toast.message("Stop requested");
          return;
        }
        if (resolved.action === "export") {
          const s = exportActiveSession();
          if (!s) return;
          const payload = buildExportPayload(s);
          const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `spok-session-${s.id}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("Exported (secrets redacted)");
          return;
        }
        return;
      }

      const turnId = nanoid(8);

      const skillSnippet =
        attachedSkills.length > 0
          ? buildSkillAttachmentSnippet(attachedSkills)
          : "";
      const agentSnippet = selectedAgent
        ? buildAgentBrief(selectedAgent, { includeSystemPrompt: true })
        : "";
      const extensionPreamble = [agentSnippet, skillSnippet]
        .filter(Boolean)
        .join("\n\n");

      if (extensionPreamble) {
        applyStreamEvent(session.id, {
          type: "system",
          timestamp: Date.now(),
          title: "Extensions for this turn",
          content: extensionPreamble,
          status: "success",
          severity: "info",
          provider: "spok",
          meta: {
            skills: attachedSkills.map((s) => s.id),
            agentId: selectedAgent?.id,
          },
        });
      }

      let runArgs = resolved.args;
      if (
        extensionPreamble &&
        resolved.type === "prompt" &&
        Array.isArray(resolved.args)
      ) {
        const args = [...resolved.args];
        const last = args[args.length - 1];
        if (typeof last === "string" && last === text) {
          args[args.length - 1] = `${extensionPreamble}\n\n---\n\n${text}`;
          runArgs = args;
        } else if (typeof last === "string" && last.includes(text)) {
          args[args.length - 1] = `${extensionPreamble}\n\n---\n\n${last}`;
          runArgs = args;
        }
      }

      pushPromptTurn(session.id, {
        id: turnId,
        text,
        label: resolved.label,
        timestamp: Date.now(),
        status: "running",
      });
      setHint(null);
      busyRef.current = true;
      setBusy(true);
      clearSelectedSkills();

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        try {
          const { results } = await runSessionHooks({
            event: "prompt_submit",
            sessionId: session.id,
            cwd: session.config.cwd,
            vars: { prompt: text.slice(0, 200) },
          });
          applyHookResultsToSession(session.id, results, (sid, ev) => {
            applyStreamEvent(sid, ev);
          });
        } catch {
          /* non-fatal */
        }

        await runHarness({
          sessionId: session.id,
          cwd: session.config.cwd,
          command: session.config.command || "grok",
          args: runArgs,
          label: resolved.label,
          signal: ac.signal,
        });
        updatePromptTurn(session.id, turnId, { status: "success" });
      } catch (e) {
        if (!ac.signal.aborted) {
          updatePromptTurn(session.id, turnId, { status: "error" });
          toast.error(e instanceof Error ? e.message : "Run failed");
        } else {
          updatePromptTurn(session.id, turnId, { status: "cancelled" });
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
      }
    },
    [
      session,
      flags,
      setGrokFlags,
      applyStreamEvent,
      clearSessionTraces,
      stopRun,
      exportActiveSession,
      pushPromptTurn,
      updatePromptTurn,
      attachedSkills,
      selectedAgent,
      clearSelectedSkills,
    ]
  );

  // Drain queue after each finished run
  useEffect(() => {
    if (busy || promptQueue.length === 0 || !session) return;
    if (queueDrainRef.current) return;
    queueDrainRef.current = true;
    const next = promptQueue[0];
    setPromptQueue((q) => q.slice(1));
    void (async () => {
      try {
        await runPromptText(next);
      } finally {
        queueDrainRef.current = false;
      }
    })();
  }, [busy, promptQueue, session, runPromptText]);

  const submit = useCallback(async () => {
    if (!session) return;
    const text = value.trim();
    if (!text) return;

    // UI slash actions always run immediately (including stop while busy)
    if (text.startsWith("/")) {
      const resolved = resolveRun(text, flags);
      if (resolved.type === "ui") {
        setValue("");
        await runPromptText(text);
        return;
      }
    }

    if (busyRef.current || busy) {
      // Queue follow-up while live run is active
      if (promptQueue.length >= 12) {
        toast.error("Queue full (max 12). Wait for a turn to finish.");
        return;
      }
      setPromptQueue((q) => [...q, text]);
      setValue("");
      toast.message(`Queued (#${promptQueue.length + 1}) — runs after current turn`);
      return;
    }

    setValue("");
    await runPromptText(text);
  }, [session, value, flags, busy, promptQueue.length, runPromptText]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && slashQuery !== null)) {
        // Enter with open slash menu inserts command (unless shift)
        if (e.key === "Tab" || value.trim() === `/${slashQuery}`) {
          e.preventDefault();
          applySlash(slashMatches[slashIdx]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  if (!session) return null;

  const isLive = session.status === "running" || session.status === "starting";

  return (
    <div className="relative border-t border-phosphor-green/20 bg-crt-panel">
      {/* Slash menu */}
      {slashOpen && (
        <div className="absolute bottom-full left-0 right-0 z-40 mx-2 mb-1 max-h-64 overflow-auto rounded-lg border border-phosphor-green/30 bg-black/95 shadow-[0_0_30px_rgba(51,255,102,0.12)]">
          <div className="sticky top-0 border-b border-phosphor-green/15 px-3 py-1.5 text-[10px] uppercase tracking-widest text-phosphor-green/40">
            <Slash className="mr-1 inline h-3 w-3" />
            Grok commands · filter as you type
          </div>
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              className={cn(
                "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors",
                i === slashIdx
                  ? "bg-phosphor-green/15 text-phosphor-green"
                  : "text-phosphor-green/70 hover:bg-phosphor-green/8"
              )}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => applySlash(cmd)}
            >
              <span className="shrink-0 font-mono text-phosphor-cyan">
                /{cmd.name}
              </span>
              {cmd.argsHint && (
                <span className="shrink-0 font-mono text-phosphor-green/35">
                  {cmd.argsHint}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-phosphor-green/50">
                {cmd.description}
              </span>
              <Badge variant="muted" className="shrink-0">
                {cmd.group}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* Sticky flags strip + permission mode */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-phosphor-green/10 px-3 py-1.5">
        <Terminal className="h-3 w-3 text-phosphor-green/40" />
        <span className="font-mono text-[10px] text-phosphor-green/40">
          {session.config.cwd}
        </span>
        <span className="text-phosphor-green/20">·</span>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-phosphor-cyan/25 px-1.5 py-0.5 font-mono text-[9px] text-phosphor-cyan/80 hover:border-phosphor-cyan/50 hover:bg-phosphor-cyan/5"
          title="Spok app permission mode (Settings)"
        >
          app:{appPermissionMode}
        </button>
        <label className="inline-flex items-center gap-1" title="Grok CLI permission flags for this session">
          <span className="text-[9px] uppercase tracking-wider text-phosphor-green/35">
            cli
          </span>
          <select
            className="h-5 max-w-[140px] rounded border border-phosphor-green/25 bg-black/60 px-1 font-mono text-[10px] text-phosphor-green outline-none focus:border-phosphor-amber/50"
            value={flags.alwaysApprove ? "always-approve" : flags.permissionMode || "manual"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "always-approve") {
                setGrokFlags(session.id, {
                  alwaysApprove: true,
                  permissionMode: undefined,
                });
                toast.message("always-approve ON — tools run without prompts");
              } else if (v === "manual") {
                setGrokFlags(session.id, {
                  alwaysApprove: false,
                  permissionMode: undefined,
                });
              } else {
                setGrokFlags(session.id, {
                  alwaysApprove: false,
                  permissionMode: v,
                });
              }
            }}
          >
            <option value="manual">manual (safe)</option>
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="plan">plan</option>
            <option value="auto">auto</option>
            <option value="dontAsk">dontAsk</option>
            <option value="bypassPermissions">bypassPermissions</option>
            <option value="always-approve">always-approve (yolo)</option>
          </select>
        </label>
        <Badge
          variant={flags.alwaysApprove ? "amber" : "muted"}
          title={
            flags.alwaysApprove
              ? "Auto-approves all tool executions — use only in trusted disposable workspaces"
              : "Grok CLI permission mode for this session"
          }
        >
          {permissionModeLabel(flags)}
        </Badge>
        {flags.model && <Badge variant="cyan">model:{flags.model}</Badge>}
        {flags.effort && <Badge variant="magenta">effort:{flags.effort}</Badge>}
        {flags.debug && <Badge variant="error">debug</Badge>}
        {flags.noPlan && <Badge variant="muted">no-plan</Badge>}
        {isLive && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-phosphor-green">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-green" />
            RUNNING
            {promptQueue.length > 0 && (
              <span className="text-phosphor-amber">
                · {promptQueue.length} queued
              </span>
            )}
          </span>
        )}
      </div>

      {promptQueue.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-phosphor-amber/25 bg-phosphor-amber/5 px-3 py-1.5">
          <span className="text-[9px] uppercase tracking-widest text-phosphor-amber/80">
            Queue
          </span>
          {promptQueue.map((q, i) => (
            <button
              key={`${i}-${q.slice(0, 12)}`}
              type="button"
              title={q}
              onClick={() =>
                setPromptQueue((prev) => prev.filter((_, j) => j !== i))
              }
              className="max-w-[180px] truncate rounded border border-phosphor-amber/30 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-amber hover:border-phosphor-red/40"
            >
              {i + 1}. {q}
              <X className="ml-1 inline h-2.5 w-2.5 opacity-60" />
            </button>
          ))}
          <button
            type="button"
            className="ml-auto text-[9px] uppercase tracking-wider text-phosphor-green/40 hover:text-phosphor-red"
            onClick={() => setPromptQueue([])}
          >
            Clear queue
          </button>
        </div>
      )}

      {hint && (
        <div className="border-b border-phosphor-cyan/20 bg-phosphor-cyan/5 px-3 py-1.5 text-[11px] text-phosphor-cyan/80">
          {hint}
        </div>
      )}

      {/* Extension chips — only when user attached something */}
      {(attachedSkills.length > 0 || selectedAgent) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-phosphor-cyan/15 bg-phosphor-cyan/5 px-3 py-1.5">
          <Sparkles className="h-3 w-3 text-phosphor-cyan/70" />
          <span className="text-[9px] uppercase tracking-widest text-phosphor-cyan/50">
            This turn
          </span>
          {selectedAgent && (
            <button
              type="button"
              onClick={() => setSelectedAgentId(null)}
              className="inline-flex items-center gap-1 rounded border border-phosphor-cyan/30 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-cyan hover:border-phosphor-cyan/60"
            >
              <Bot className="h-2.5 w-2.5" />
              {selectedAgent.name}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          )}
          {attachedSkills.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSelectedSkill(s.id)}
              className="inline-flex items-center gap-1 rounded border border-phosphor-green/30 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-green/80 hover:border-phosphor-green/60"
              title={s.description}
            >
              {s.name}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          ))}
          <span className="text-[9px] text-phosphor-green/35">
            Compact skill index only — not full bodies
          </span>
        </div>
      )}

      {/* Recent turns */}
      {(session.promptHistory?.length ?? 0) > 0 && (
        <div className="flex max-h-16 gap-1 overflow-x-auto border-b border-phosphor-green/10 px-2 py-1">
          {[...(session.promptHistory ?? [])].slice(-8).reverse().map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.text}
              onClick={() => setValue(t.text)}
              className={cn(
                "max-w-[160px] shrink-0 truncate rounded border px-1.5 py-0.5 font-mono text-[10px]",
                t.status === "running"
                  ? "border-phosphor-amber/40 text-phosphor-amber"
                  : t.status === "error"
                    ? "border-red-500/40 text-red-400"
                    : "border-phosphor-green/20 text-phosphor-green/55 hover:border-phosphor-green/40"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2">
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={
              busy
                ? "Type a follow-up and Enter to queue…  (runs after current turn)"
                : "Prompt Grok…  or type / for commands (e.g. /continue, /model, /always-approve)"
            }
            className="w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-2 font-mono text-sm text-phosphor-green outline-none placeholder:text-phosphor-green/30 focus:border-phosphor-green/50 focus:ring-1 focus:ring-phosphor-green/40 focus:ring-[var(--focus-ring)]"
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {(busy || isLive) && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void stopRun()}
              title="Stop run and clear queue"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          {busy || isLive ? (
            <Button
              size="sm"
              variant="amber"
              onClick={() => void submit()}
              disabled={!value.trim()}
              title="Queue follow-up (Enter)"
            >
              <Layers className="h-3.5 w-3.5" />
              Queue
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => void submit()}
                disabled={!value.trim()}
                title="Send (Enter)"
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
                Send
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!value.trim() || !session.config.cwd}
                title="Queue as background job — keeps this session free"
                onClick={() => {
                  const text = value.trim();
                  if (!text || !session.config.cwd) return;
                  enqueueBackgroundJob({
                    title: text.slice(0, 48),
                    prompt: text,
                    cwd: session.config.cwd,
                    isolate: true,
                    parentSessionId: session.id,
                  });
                  setValue("");
                  toast.success("Queued in background", {
                    description: "Open Monitor to track progress",
                    action: {
                      label: "Monitor",
                      onClick: () =>
                        useSpokStore.getState().setMonitorOpen(true),
                    },
                  });
                }}
              >
                <Layers className="h-3.5 w-3.5" />
                BG
              </Button>
            </>
          )}
          {busy && (
            <span className="inline-flex items-center justify-center gap-1 text-[10px] text-phosphor-amber">
              <Loader2 className="h-3 w-3 animate-spin" />
              live
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-1.5 text-[10px] text-phosphor-green/30">
        <span>
          <kbd className="rounded border border-phosphor-green/20 px-1">Enter</kbd>{" "}
          {busy ? "queue" : "send"} ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">Shift+Enter</kbd>{" "}
          newline ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">/</kbd>{" "}
          commands
        </span>
        <button
          type="button"
          onClick={() => setExtensionsOpen(true)}
          className="inline-flex items-center gap-1 font-mono text-phosphor-green/40 hover:text-phosphor-cyan"
          title="Open Extension Center"
        >
          <Puzzle className="h-3 w-3" />
          extensions
          {skillCatalog.length > 0 && (
            <span className="text-phosphor-green/25">
              · {skillCatalog.length} skills
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
