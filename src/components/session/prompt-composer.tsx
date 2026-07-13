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
  Paperclip,
  FileText,
  FileImage,
  File as FileIcon,
  FileType,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EffectivePolicySummaryView } from "@/components/session/effective-policy-summary";
import { useSpokStore } from "@/lib/store";
import { runHarness } from "@/lib/harness";
import {
  defaultGrokFlags,
  filterSlashCommands,
  resolveRun,
  slashRiskLabel,
  type GrokRunFlags,
  type SlashCommand,
} from "@/lib/grok-commands";
import {
  buildEffectivePolicySummary,
  buildEscalationConfirmation,
  currentProviderSelection,
  flagsForProviderSelection,
  isHighRiskProviderMode,
  isProviderPermissionSelection,
  requiresEscalationConfirmation,
  type ProviderPermissionSelection,
} from "@/lib/security/effective-policy";
import { gateProviderPermissionPatch } from "@/lib/security/slash-permission-gate";
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
import {
  formatAttachmentSize,
  prepareAttachedPrompt,
  removeAttachment,
  uploadAttachments,
} from "@/lib/attachments-client";
import type { PromptAttachmentRef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_COMPOSER_ATTACHMENTS = 8;

type QueuedPrompt = {
  text: string;
  attachments: PromptAttachmentRef[];
};

function attachmentIcon(kind: string) {
  switch (kind) {
    case "image":
      return FileImage;
    case "document":
      return FileType;
    case "text":
      return FileText;
    default:
      return FileIcon;
  }
}

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

type PromptComposerProps = {
  /**
   * `mobile` — large touch targets, minimal chrome (phone shell).
   * Desktop default is unchanged.
   */
  variant?: "desktop" | "mobile";
};

export function PromptComposer({ variant = "desktop" }: PromptComposerProps) {
  const mobile = variant === "mobile";
  // Field-level selectors: the composer is always mounted and must not
  // re-render on every thinking token.
  const sessionId = useSpokStore((s) => s.activeSessionId);
  const sessionStatus = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.status : undefined
  );
  const sessionCwd = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.config.cwd : undefined
  );
  const sessionCommand = useSpokStore((s) =>
    s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.config.command
      : undefined
  );
  const grokFlags = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.grokFlags : undefined
  );
  // Re-render when prompt history membership/status changes (not every stream token).
  const promptHistoryKey = useSpokStore((s) => {
    const h = s.activeSessionId
      ? s.sessions[s.activeSessionId!]?.promptHistory
      : undefined;
    if (!h?.length) return "0";
    const last = h[h.length - 1];
    return `${h.length}:${last?.id}:${last?.status}`;
  });
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
  const composerPrefill = useSpokStore((s) => s.composerPrefill);
  const clearComposerPrefill = useSpokStore((s) => s.clearComposerPrefill);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  /** Follow-up prompts queued while a run is active (Phase 7). */
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  /** Pending file attachments for the next send (opaque ids, no paths). */
  const [attachments, setAttachments] = useState<PromptAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [skillCatalog, setSkillCatalog] = useState<SkillDescriptor[]>([]);
  const [agentCatalog, setAgentCatalog] = useState<CustomAgentConfig[]>([]);
  /** High-risk provider mode awaiting scope/duration confirm (no mutate until Confirm). */
  const [pendingEscalation, setPendingEscalation] =
    useState<ProviderPermissionSelection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const queueDrainRef = useRef(false);

  // Fresh session snapshot when identity/status/history/flags change.
  void promptHistoryKey;
  void sessionStatus;
  void sessionCwd;
  void sessionCommand;
  const session = sessionId
    ? useSpokStore.getState().sessions[sessionId] ?? null
    : null;

  // Validation recipes / command palette inject prompts once.
  useEffect(() => {
    if (!composerPrefill) return;
    setValue(composerPrefill);
    clearComposerPrefill();
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = composerPrefill.length;
      el.setSelectionRange(len, len);
    });
  }, [composerPrefill, clearComposerPrefill]);

  const flags = useMemo(
    () => flagsFromSession(grokFlags),
    [grokFlags]
  );

  const providerSelection = useMemo(
    () => currentProviderSelection(flags),
    [flags]
  );

  const effectivePolicy = useMemo(
    () =>
      buildEffectivePolicySummary({
        appPermissionMode,
        flags,
        cwd: sessionCwd,
      }),
    [appPermissionMode, flags, sessionCwd]
  );

  const escalationCopy = useMemo(
    () =>
      pendingEscalation
        ? buildEscalationConfirmation(pendingEscalation, { cwd: sessionCwd })
        : null,
    [pendingEscalation, sessionCwd]
  );

  const applyProviderSelection = useCallback(
    (selection: ProviderPermissionSelection) => {
      if (!sessionId) return;
      setGrokFlags(sessionId, flagsForProviderSelection(selection));
    },
    [sessionId, setGrokFlags]
  );

  const onProviderPermissionChange = useCallback(
    (raw: string) => {
      if (!isProviderPermissionSelection(raw)) return;
      const next = raw;
      if (requiresEscalationConfirmation(providerSelection, next)) {
        // Controlled select stays on current flags until Confirm.
        setPendingEscalation(next);
        return;
      }
      // De-escalation and non-high-risk changes apply immediately.
      applyProviderSelection(next);
    },
    [providerSelection, applyProviderSelection]
  );

  const confirmEscalation = useCallback(() => {
    if (!pendingEscalation) return;
    const target = pendingEscalation;
    applyProviderSelection(target);
    setPendingEscalation(null);
    if (isHighRiskProviderMode(target)) {
      toast.warning(
        `${target} enabled for this session — elevated risk remains visible until you switch back.`
      );
    }
  }, [pendingEscalation, applyProviderSelection]);

  const cancelEscalation = useCallback(() => {
    setPendingEscalation(null);
  }, []);

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

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!session) return;
      const incoming = Array.from(fileList).filter((f) => f && f.size > 0);
      if (!incoming.length) return;
      const room = MAX_COMPOSER_ATTACHMENTS - attachments.length;
      if (room <= 0) {
        toast.error(`Max ${MAX_COMPOSER_ATTACHMENTS} attachments per message`);
        return;
      }
      const batch = incoming.slice(0, room);
      if (incoming.length > room) {
        toast.message(`Only ${room} more file(s) allowed — extras skipped`);
      }
      setUploading(true);
      try {
        const { attachments: saved, errors } = await uploadAttachments(
          session.id,
          batch
        );
        if (saved.length) {
          setAttachments((prev) => {
            const ids = new Set(prev.map((a) => a.id));
            return [...prev, ...saved.filter((a) => !ids.has(a.id))];
          });
        }
        if (errors?.length) {
          toast.error(errors[0]);
        } else if (saved.length) {
          toast.success(
            saved.length === 1
              ? `Attached ${saved[0].name}`
              : `Attached ${saved.length} files`
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [session, attachments.length]
  );

  const dropAttachment = useCallback(
    async (id: string) => {
      if (!session) return;
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      try {
        await removeAttachment(session.id, id);
      } catch {
        /* best-effort cleanup */
      }
    },
    [session]
  );

  /** Execute one prompt turn (must not be called while busyRef is true). */
  const runPromptText = useCallback(
    async (text: string, turnAttachments: PromptAttachmentRef[] = []) => {
      if (!session) return;
      const resolved = resolveRun(text, flags);

      if (resolved.type === "ui") {
        if (resolved.action === "set-flag" && resolved.flags) {
          const patch = resolved.flags as Record<string, unknown>;
          // Gate provider permission escalations before setGrokFlags mutates.
          const gate = gateProviderPermissionPatch(flags, patch);
          if (gate.kind === "confirm") {
            setPendingEscalation(gate.selection);
            setHint(
              `Confirm elevated permissions: ${gate.selection} (scope/duration dialog)`
            );
            toast.message(
              "Elevated permission requires confirmation — review scope and duration"
            );
            return;
          }
          if (gate.kind === "apply") {
            setGrokFlags(session.id, gate.flags);
            const msg =
              resolved.message ?? `Permission: ${gate.selection}`;
            setHint(msg);
            toast.message(msg);
            return;
          }
          // Non-permission flags (model, debug, …) apply immediately.
          setGrokFlags(session.id, patch);
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
      let effectivePrompt = text;
      if (
        extensionPreamble &&
        resolved.type === "prompt" &&
        Array.isArray(resolved.args)
      ) {
        const args = [...resolved.args];
        const last = args[args.length - 1];
        if (typeof last === "string" && last === text) {
          effectivePrompt = `${extensionPreamble}\n\n---\n\n${text}`;
          args[args.length - 1] = effectivePrompt;
          runArgs = args;
        } else if (typeof last === "string" && last.includes(text)) {
          effectivePrompt = `${extensionPreamble}\n\n---\n\n${last}`;
          args[args.length - 1] = effectivePrompt;
          runArgs = args;
        }
      }

      // Attachments → ACP content blocks via --prompt-file (vision + documents)
      if (
        turnAttachments.length > 0 &&
        resolved.type === "prompt"
      ) {
        try {
          const prepared = await prepareAttachedPrompt({
            sessionId: session.id,
            turnId,
            prompt: effectivePrompt,
            attachmentIds: turnAttachments.map((a) => a.id),
            baseArgs: runArgs,
          });
          runArgs = prepared.args;
          if (prepared.warnings.length) {
            applyStreamEvent(session.id, {
              type: "system",
              timestamp: Date.now(),
              title: "Attachment notes",
              content: prepared.warnings.join("\n"),
              status: "success",
              severity: "info",
              provider: "spok",
            });
          }
          applyStreamEvent(session.id, {
            type: "system",
            timestamp: Date.now(),
            title: "Attachments",
            content: turnAttachments
              .map(
                (a) =>
                  `• ${a.name} (${a.kind}, ${formatAttachmentSize(a.size)})`
              )
              .join("\n"),
            status: "success",
            severity: "info",
            provider: "spok",
            meta: {
              attachments: turnAttachments.map((a) => ({
                id: a.id,
                name: a.name,
                kind: a.kind,
                mimeType: a.mimeType,
                size: a.size,
              })),
            },
          });
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "Failed to prepare attachments"
          );
          return;
        }
      }

      const attachLabel =
        turnAttachments.length > 0
          ? ` [${turnAttachments.length} file${turnAttachments.length === 1 ? "" : "s"}]`
          : "";

      pushPromptTurn(session.id, {
        id: turnId,
        text,
        label: `${resolved.label}${attachLabel}`.slice(0, 100),
        timestamp: Date.now(),
        status: "running",
        attachments: turnAttachments.length ? turnAttachments : undefined,
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
            vars: {
              prompt: text.slice(0, 200),
              attachmentCount: String(turnAttachments.length),
            },
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
      setPendingEscalation,
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
        await runPromptText(next.text, next.attachments);
      } finally {
        queueDrainRef.current = false;
      }
    })();
  }, [busy, promptQueue, session, runPromptText]);

  const submit = useCallback(async () => {
    if (!session) return;
    const text = value.trim();
    const pending = [...attachments];
    if (!text && pending.length === 0) return;

    // UI slash actions always run immediately (including stop while busy)
    if (text.startsWith("/") && pending.length === 0) {
      const resolved = resolveRun(text, flags);
      if (resolved.type === "ui") {
        setValue("");
        await runPromptText(text);
        return;
      }
    }

    const promptText =
      text ||
      (pending.length === 1
        ? "Please analyze the attached file."
        : "Please analyze the attached files.");

    if (busyRef.current || busy) {
      // Queue follow-up while live run is active
      if (promptQueue.length >= 12) {
        toast.error("Queue full (max 12). Wait for a turn to finish.");
        return;
      }
      setPromptQueue((q) => [
        ...q,
        { text: promptText, attachments: pending },
      ]);
      setValue("");
      setAttachments([]);
      toast.message(
        `Queued (#${promptQueue.length + 1}) — runs after current turn`
      );
      return;
    }

    setValue("");
    setAttachments([]);
    await runPromptText(promptText, pending);
  }, [
    session,
    value,
    attachments,
    flags,
    busy,
    promptQueue.length,
    runPromptText,
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
    <div
      className={cn(
        "relative border-t border-phosphor-green/20 bg-crt-panel",
        mobile && "border-phosphor-green/10 pb-[env(safe-area-inset-bottom)]"
      )}
      data-testid="prompt-composer"
      data-variant={variant}
    >
      {/* Slash command picker */}
      {slashOpen && (
        <div className="absolute bottom-full left-0 right-0 z-40 mx-2 mb-1 max-h-72 overflow-auto rounded-lg border border-phosphor-green/30 bg-black/95 shadow-lg">
          <div className="sticky top-0 border-b border-phosphor-green/15 px-3 py-1.5 text-[10px] uppercase tracking-widest text-phosphor-green/40">
            <Slash className="mr-1 inline h-3 w-3" />
            {mobile ? "Commands" : "Commands · categories · risk labels"}
          </div>
          {slashMatches.map((cmd, i) => {
            const risk = slashRiskLabel(cmd.risk);
            return (
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
                {cmd.example && (
                  <span className="hidden max-w-[140px] truncate font-mono text-[9px] text-phosphor-green/30 sm:inline">
                    {cmd.example}
                  </span>
                )}
                <Badge variant="muted" className="shrink-0">
                  {cmd.group}
                </Badge>
                {risk && (
                  <Badge
                    variant={cmd.risk === "high" ? "error" : "amber"}
                    className="shrink-0 text-[8px]"
                  >
                    {risk}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Structured run cockpit — full on desktop, minimal status on mobile */}
      {!mobile ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-phosphor-green/10 px-3 py-1.5">
          <div className="inline-flex min-w-0 max-w-[40%] items-center gap-1.5">
            <Terminal className="h-3 w-3 shrink-0 text-phosphor-green/40" />
            <span
              className="truncate font-mono text-[10px] text-phosphor-green/45"
              title={session.config.cwd}
            >
              {session.config.cwd || "no cwd"}
            </span>
          </div>

          <EffectivePolicySummaryView summary={effectivePolicy} />

          <label
            className="inline-flex items-center gap-1"
            title="App permission policy (Settings)"
          >
            <span className="text-[9px] text-phosphor-green/40">App</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded border border-phosphor-cyan/25 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-cyan/85 hover:border-phosphor-cyan/50"
              data-testid="composer-app-permission"
            >
              {appPermissionMode}
            </button>
          </label>

          <label
            className="inline-flex items-center gap-1"
            title="Grok CLI permission mode for this session — high-risk modes require confirmation"
          >
            <span className="text-[9px] text-phosphor-green/40">Permission</span>
            <select
              className="h-6 max-w-[160px] rounded border border-phosphor-green/25 bg-black/60 px-1.5 text-[10px] text-phosphor-green outline-none focus:border-phosphor-amber/50"
              data-testid="permission-mode-select"
              value={providerSelection}
              onChange={(e) => onProviderPermissionChange(e.target.value)}
            >
              <option value="manual">Manual (safe)</option>
              <option value="default">Default</option>
              <option value="acceptEdits">Accept edits</option>
              <option value="plan">Plan</option>
              <option value="auto">Auto</option>
              <option value="dontAsk">Don&apos;t ask</option>
              <option value="bypassPermissions">Bypass permissions</option>
              <option value="always-approve">Always approve (high risk)</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-1" title="Model sticky flag">
            <span className="text-[9px] text-phosphor-green/40">Model</span>
            <input
              className="h-6 w-24 rounded border border-phosphor-green/20 bg-black/50 px-1.5 font-mono text-[10px] text-phosphor-green outline-none focus:border-phosphor-cyan/40"
              placeholder="default"
              value={flags.model ?? ""}
              onChange={(e) =>
                setGrokFlags(session.id, {
                  model: e.target.value.trim() || undefined,
                })
              }
            />
          </label>

          <label className="inline-flex items-center gap-1" title="Run mode">
            <span className="text-[9px] text-phosphor-green/40">Run</span>
            <select
              className="h-6 rounded border border-phosphor-green/20 bg-black/50 px-1 text-[10px] text-phosphor-green outline-none"
              value={flags.check ? "check" : "agent"}
              onChange={(e) =>
                setGrokFlags(session.id, { check: e.target.value === "check" })
              }
            >
              <option value="agent">Agent</option>
              <option value="check">Check only</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => setExtensionsOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-phosphor-green/15 px-1.5 py-0.5 text-[10px] text-phosphor-green/55 hover:border-phosphor-cyan/40 hover:text-phosphor-cyan"
            title="Attach skills or agent for next turn"
          >
            <Sparkles className="h-3 w-3" />
            Skills
            {(attachedSkills.length > 0 || selectedAgent) && (
              <span className="font-mono text-phosphor-cyan">
                {attachedSkills.length + (selectedAgent ? 1 : 0)}
              </span>
            )}
          </button>

          {flags.effort && (
            <Badge variant="magenta">effort:{flags.effort}</Badge>
          )}
          {flags.debug && <Badge variant="error">debug</Badge>}

          {isLive && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-phosphor-amber">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-phosphor-amber" />
              Running
              {promptQueue.length > 0 && (
                <span>· {promptQueue.length} queued</span>
              )}
            </span>
          )}
        </div>
      ) : (
        isLive && (
          <div className="flex items-center gap-2 border-b border-phosphor-amber/20 bg-phosphor-amber/5 px-3 py-1.5 text-xs text-phosphor-amber">
            <span className="live-dot h-2 w-2 rounded-full bg-phosphor-amber" />
            Running on host PC
            {promptQueue.length > 0 && (
              <span className="text-phosphor-amber/70">
                · {promptQueue.length} queued
              </span>
            )}
          </div>
        )
      )}

      {promptQueue.length > 0 && (
        <div
          className="border-b border-phosphor-amber/25 bg-phosphor-amber/5 px-3 py-1.5"
          data-testid="prompt-queue"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-widest text-phosphor-amber/80">
              Follow-up queue
            </span>
            <button
              type="button"
              className="ml-auto text-[9px] uppercase tracking-wider text-phosphor-green/40 hover:text-red-400"
              onClick={() => setPromptQueue([])}
            >
              Clear
            </button>
          </div>
          <ol className="space-y-1">
            {promptQueue.map((q, i) => (
              <li
                key={`${i}-${q.text.slice(0, 24)}-${q.attachments.map((a) => a.id).join(",")}`}
                className="flex items-center gap-1.5 rounded border border-phosphor-amber/25 bg-black/35 px-1.5 py-1"
              >
                <span className="w-4 shrink-0 font-mono text-[10px] text-phosphor-amber/70">
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-phosphor-amber hover:underline"
                  title="Edit — load into composer"
                  onClick={() => {
                    setValue(q.text);
                    setAttachments((prev) => {
                      const ids = new Set(prev.map((a) => a.id));
                      return [
                        ...prev,
                        ...q.attachments.filter((a) => !ids.has(a.id)),
                      ].slice(0, MAX_COMPOSER_ATTACHMENTS);
                    });
                    setPromptQueue((prev) => prev.filter((_, j) => j !== i));
                    taRef.current?.focus();
                  }}
                >
                  {q.text}
                  {q.attachments.length > 0 && (
                    <span className="text-phosphor-amber/60">
                      {" "}
                      · {q.attachments.length} file
                      {q.attachments.length === 1 ? "" : "s"}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="shrink-0 px-1 text-[10px] text-phosphor-green/40 hover:text-phosphor-cyan disabled:opacity-30"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() =>
                    setPromptQueue((prev) => {
                      if (i === 0) return prev;
                      const next = [...prev];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="shrink-0 px-1 text-[10px] text-phosphor-green/40 hover:text-phosphor-cyan disabled:opacity-30"
                  disabled={i === promptQueue.length - 1}
                  title="Move down"
                  onClick={() =>
                    setPromptQueue((prev) => {
                      if (i >= prev.length - 1) return prev;
                      const next = [...prev];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      return next;
                    })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="shrink-0 text-phosphor-green/40 hover:text-red-400"
                  title="Remove"
                  onClick={() =>
                    setPromptQueue((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ol>
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

      {/* File attachment chips */}
      {attachments.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 border-b border-phosphor-green/15 bg-black/30 px-3 py-1.5"
          data-testid="composer-attachments"
        >
          <Paperclip className="h-3 w-3 text-phosphor-green/50" />
          <span className="text-[9px] uppercase tracking-widest text-phosphor-green/40">
            Attached
          </span>
          {attachments.map((a) => {
            const Icon = attachmentIcon(a.kind);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => void dropAttachment(a.id)}
                className="inline-flex max-w-[200px] items-center gap-1 rounded border border-phosphor-green/30 bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-phosphor-green/85 hover:border-red-400/50 hover:text-red-300"
                title={`${a.name} · ${formatAttachmentSize(a.size)} · click to remove`}
              >
                <Icon className="h-2.5 w-2.5 shrink-0 opacity-70" />
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="shrink-0 text-phosphor-green/35">
                  {formatAttachmentSize(a.size)}
                </span>
                <X className="h-2.5 w-2.5 shrink-0 opacity-50" />
              </button>
            );
          })}
          {uploading && (
            <span className="inline-flex items-center gap-1 text-[10px] text-phosphor-amber">
              <Loader2 className="h-3 w-3 animate-spin" />
              uploading…
            </span>
          )}
        </div>
      )}

      {/* Recent turns — skip on mobile to save space */}
      {!mobile && (session.promptHistory?.length ?? 0) > 0 && (
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

      <div
        className={cn(
          "flex items-end gap-2 p-2 transition-colors",
          mobile && "gap-2.5 p-3",
          dragOver && "bg-phosphor-cyan/10"
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.types.includes("Files")) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.types.includes("Files")) {
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Only clear when leaving the container (not child nodes)
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          if (e.dataTransfer.files?.length) {
            void addFiles(e.dataTransfer.files);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.log,.xml,.yaml,.yml,.toml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.html,.css"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size={mobile ? "default" : "sm"}
          variant="outline"
          className={cn(
            "shrink-0",
            mobile ? "min-h-11 min-w-11" : "h-9 w-9 p-0",
            attachments.length > 0 && "border-phosphor-cyan/40 text-phosphor-cyan"
          )}
          title="Attach files (images, PDFs, documents)"
          disabled={uploading || attachments.length >= MAX_COMPOSER_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
          data-testid="composer-attach"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
        </Button>
        <div className="relative min-w-0 flex-1">
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border border-dashed border-phosphor-cyan/50 bg-phosphor-cyan/10 text-xs text-phosphor-cyan">
              Drop files to attach
            </div>
          )}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === "file") {
                  const f = item.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            rows={mobile ? 3 : 2}
            placeholder={
              busy
                ? mobile
                  ? "Follow-up… (queues until done)"
                  : "Type a follow-up and Enter to queue…  (runs after current turn)"
                : mobile
                  ? "Message Grok… drop files to attach"
                  : "Prompt Grok… attach files, type / for commands"
            }
            className={cn(
              "w-full resize-none rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-2 text-sm text-phosphor-green outline-none placeholder:text-phosphor-green/30 focus:border-phosphor-green/50 focus:ring-1 focus:ring-[var(--focus-ring)]",
              mobile ? "min-h-[5.5rem] text-base leading-relaxed" : "font-mono"
            )}
          />
        </div>
        <div className={cn("flex shrink-0 flex-col gap-1", mobile && "gap-1.5")}>
          {(busy || isLive) && (
            <Button
              variant="destructive"
              size={mobile ? "default" : "sm"}
              className={mobile ? "min-h-11 min-w-[4.5rem]" : undefined}
              onClick={() => void stopRun()}
              title="Stop run and clear queue"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          {busy || isLive ? (
            <Button
              size={mobile ? "default" : "sm"}
              variant="amber"
              className={mobile ? "min-h-11 min-w-[4.5rem]" : undefined}
              onClick={() => void submit()}
              disabled={!value.trim() && attachments.length === 0}
              title="Queue follow-up (Enter)"
            >
              <Layers className="h-3.5 w-3.5" />
              Queue
            </Button>
          ) : (
            <>
              <Button
                size={mobile ? "default" : "sm"}
                className={mobile ? "min-h-11 min-w-[4.5rem]" : undefined}
                onClick={() => void submit()}
                disabled={
                  (!value.trim() && attachments.length === 0) || uploading
                }
                title="Send (Enter)"
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
                Send
              </Button>
              {!mobile && (
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
              )}
            </>
          )}
          {busy && !mobile && (
            <span className="inline-flex items-center justify-center gap-1 text-[10px] text-phosphor-amber">
              <Loader2 className="h-3 w-3 animate-spin" />
              live
            </span>
          )}
        </div>
      </div>

      {!mobile && (
        <div className="flex items-center justify-between px-3 pb-1.5 text-[10px] text-phosphor-green/30">
          <span>
            <kbd className="rounded border border-phosphor-green/20 px-1">
              Enter
            </kbd>{" "}
            {busy ? "queue" : "send"} ·{" "}
            <kbd className="rounded border border-phosphor-green/20 px-1">
              Shift+Enter
            </kbd>{" "}
            newline ·{" "}
            <kbd className="rounded border border-phosphor-green/20 px-1">/</kbd>{" "}
            commands · drop files to attach
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
      )}

      {escalationCopy && (
        <ConfirmDialog
          open={!!pendingEscalation}
          title={escalationCopy.title}
          description={escalationCopy.description}
          detail={escalationCopy.detail}
          confirmLabel={escalationCopy.confirmLabel}
          cancelLabel="Cancel"
          tone={escalationCopy.tone}
          onConfirm={confirmEscalation}
          onCancel={cancelEscalation}
          testId="permission-escalation-dialog"
        />
      )}
    </div>
  );
}
