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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSpokStore } from "@/lib/store";
import { runHarness } from "@/lib/harness";
import {
  defaultGrokFlags,
  filterSlashCommands,
  resolveRun,
  type GrokRunFlags,
  type SlashCommand,
} from "@/lib/grok-commands";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function flagsFromSession(raw?: Record<string, unknown>): GrokRunFlags {
  const d = defaultGrokFlags();
  if (!raw) return d;
  return {
    ...d,
    ...raw,
    alwaysApprove: raw.alwaysApprove !== false,
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

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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
    if (session) {
      await fetch(
        `/api/session/start?sessionId=${encodeURIComponent(session.id)}`,
        { method: "DELETE" }
      ).catch(() => undefined);
    }
    setBusy(false);
  }, [session]);

  const submit = useCallback(async () => {
    if (!session || busy) return;
    const text = value.trim();
    if (!text) return;

    const resolved = resolveRun(text, flags);

    if (resolved.type === "ui") {
      if (resolved.action === "set-flag" && resolved.flags) {
        setGrokFlags(session.id, resolved.flags as Record<string, unknown>);
        setHint(resolved.message ?? "Flag updated");
        toast.message(resolved.message ?? "Flag updated");
        setValue("");
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
        setValue("");
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
        const blob = new Blob(
          [JSON.stringify({ version: 1, exportedAt: Date.now(), session: s }, null, 2)],
          { type: "application/json" }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `spok-session-${s.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Exported");
        return;
      }
      return;
    }

    const turnId = nanoid(8);
    pushPromptTurn(session.id, {
      id: turnId,
      text,
      label: resolved.label,
      timestamp: Date.now(),
      status: "running",
    });
    setValue("");
    setHint(null);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await runHarness({
        sessionId: session.id,
        cwd: session.config.cwd,
        command: session.config.command || "grok",
        args: resolved.args,
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
      setBusy(false);
      abortRef.current = null;
    }
  }, [
    session,
    busy,
    value,
    flags,
    setGrokFlags,
    applyStreamEvent,
    clearSessionTraces,
    stopRun,
    exportActiveSession,
    pushPromptTurn,
    updatePromptTurn,
  ]);

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

      {/* Sticky flags strip */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-phosphor-green/10 px-3 py-1.5">
        <Terminal className="h-3 w-3 text-phosphor-green/40" />
        <span className="font-mono text-[10px] text-phosphor-green/40">
          {session.config.cwd}
        </span>
        <span className="text-phosphor-green/20">·</span>
        {flags.model && <Badge variant="cyan">model:{flags.model}</Badge>}
        {flags.alwaysApprove && <Badge variant="amber">always-approve</Badge>}
        {flags.effort && <Badge variant="magenta">effort:{flags.effort}</Badge>}
        {flags.permissionMode && (
          <Badge variant="muted">perm:{flags.permissionMode}</Badge>
        )}
        {flags.debug && <Badge variant="error">debug</Badge>}
        {flags.noPlan && <Badge variant="muted">no-plan</Badge>}
        {isLive && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-phosphor-green">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-green" />
            RUNNING
          </span>
        )}
      </div>

      {hint && (
        <div className="border-b border-phosphor-cyan/20 bg-phosphor-cyan/5 px-3 py-1.5 text-[11px] text-phosphor-cyan/80">
          {hint}
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
            disabled={busy}
            rows={2}
            placeholder='Prompt Grok…  or type / for commands (e.g. /continue, /model, /always-approve)'
            className="w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-2 font-mono text-sm text-phosphor-green outline-none placeholder:text-phosphor-green/30 focus:border-phosphor-green/50 focus:ring-1 focus:ring-phosphor-green/40 disabled:opacity-50"
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {busy || isLive ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void stopRun()}
              title="Stop run"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={!value.trim()}
              title="Send (Enter)"
            >
              <CornerDownLeft className="h-3.5 w-3.5" />
              Send
            </Button>
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
          send ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">Shift+Enter</kbd>{" "}
          newline ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">/</kbd>{" "}
          commands
        </span>
        <span className="font-mono">{session.config.command || "grok"}</span>
      </div>
    </div>
  );
}
