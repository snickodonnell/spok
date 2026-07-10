"use client";

import { useMemo } from "react";
import {
  Brain,
  Wrench,
  FileCode2,
  Shield,
  AlertTriangle,
  MessageSquare,
  ListTree,
  X,
  Link2,
  ChevronRight,
} from "lucide-react";
import { useSpokStore } from "@/lib/store";
import {
  causalKindLabel,
  getCausalStepsForFile,
  type CausalStep,
  type CausalStepKind,
} from "@/lib/causal-links";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatRelativeTime } from "@/lib/utils";

function KindIcon({ kind }: { kind: CausalStepKind }) {
  const cls = "h-3 w-3 shrink-0";
  switch (kind) {
    case "thinking":
      return <Brain className={cls} />;
    case "tool":
      return <Wrench className={cls} />;
    case "file":
      return <FileCode2 className={cls} />;
    case "approval":
      return <Shield className={cls} />;
    case "error":
      return <AlertTriangle className={cls} />;
    case "message":
      return <MessageSquare className={cls} />;
    case "plan":
      return <ListTree className={cls} />;
    default:
      return <Link2 className={cls} />;
  }
}

function kindTone(kind: CausalStepKind): string {
  switch (kind) {
    case "error":
      return "border-red-500/30 text-red-400";
    case "tool":
      return "border-phosphor-cyan/30 text-phosphor-cyan";
    case "thinking":
      return "border-phosphor-green/25 text-phosphor-green/80";
    case "approval":
      return "border-phosphor-amber/35 text-phosphor-amber";
    case "plan":
      return "border-phosphor-magenta/30 text-phosphor-magenta/90";
    default:
      return "border-phosphor-green/15 text-phosphor-green/60";
  }
}

/**
 * "Why did this change?" drawer / rail for the selected file.
 * Lists linked thinking, tools, plans, approvals, and review comments.
 */
export function CausalRail({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const open = useSpokStore((s) => s.causalDrawerOpen);
  const setOpen = useSpokStore((s) => s.setCausalDrawerOpen);
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const setLeftTraceMode = useSpokStore((s) => s.setLeftTraceMode);
  const setViewMode = useSpokStore((s) => s.setViewMode);

  const fileId = session?.selectedFileId ?? null;
  const bundle = useMemo(() => {
    if (!session || !fileId) return null;
    return getCausalStepsForFile(session, fileId);
  }, [session, fileId]);

  if (!open || !session || !fileId || !bundle) return null;

  const onStep = (step: CausalStep) => {
    selectTrace(step.nodeId);
    setLeftTraceMode(
      step.kind === "thinking" || step.kind === "message" ? "thinking" : "events"
    );
    setViewMode("workspace");
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-64 shrink-0 flex-col border-l border-phosphor-green/15 bg-crt-panel/95",
        compact && "w-56",
        className
      )}
      data-testid="causal-rail"
      aria-label="Why did this change"
    >
      <div className="flex items-start gap-2 border-b border-phosphor-green/15 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-phosphor-green/55">
            Why this change
          </div>
          <div
            className="truncate font-mono text-[11px] text-phosphor-green/85"
            title={bundle.path}
          >
            {bundle.path}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setOpen(false)}
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2">
          {bundle.steps.length === 0 ? (
            <p className="px-1 py-3 text-[11px] leading-relaxed text-phosphor-green/45">
              No linked agent steps yet. Links appear when the stream reports
              file edits or when you select a related thinking step.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {bundle.steps.map((step, i) => (
                <li key={step.nodeId}>
                  <button
                    type="button"
                    onClick={() => onStep(step)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left transition hover:bg-phosphor-green/8",
                      kindTone(step.kind),
                      session.selectedTraceId === step.nodeId &&
                        "bg-phosphor-green/10 ring-1 ring-phosphor-green/30"
                    )}
                  >
                    <span className="mt-0.5 font-mono text-[9px] text-phosphor-green/35">
                      {i + 1}
                    </span>
                    <KindIcon kind={step.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <Badge
                          variant="muted"
                          className="h-4 px-1 text-[8px] uppercase"
                        >
                          {causalKindLabel(step.kind)}
                        </Badge>
                        {step.direct && (
                          <span className="text-[8px] uppercase tracking-wider text-phosphor-cyan/60">
                            direct
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-medium text-phosphor-green/90">
                        {step.title}
                      </span>
                      {step.summary && step.summary !== step.title && (
                        <span className="mt-0.5 line-clamp-2 block text-[10px] text-phosphor-green/45">
                          {step.summary}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[9px] text-phosphor-green/30">
                        {formatRelativeTime(step.timestamp)}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-3 w-3 shrink-0 opacity-40" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {bundle.comments.length > 0 && (
            <div className="border-t border-phosphor-green/10 pt-2">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-phosphor-cyan/60">
                Review comments
              </div>
              <ul className="space-y-1.5">
                {bundle.comments.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border border-phosphor-cyan/20 bg-phosphor-cyan/5 px-2 py-1.5 text-[11px] text-phosphor-green/75"
                  >
                    <div className="mb-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-phosphor-cyan/70">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {c.author}
                      {c.line != null && <span>· L{c.line}</span>}
                      {c.resolved && (
                        <Badge variant="success" className="h-3.5 text-[8px]">
                          resolved
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    {c.traceNodeId && (
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center gap-1 text-[10px] text-phosphor-cyan hover:underline"
                        onClick={() => {
                          selectTrace(c.traceNodeId!);
                          setLeftTraceMode("events");
                        }}
                      >
                        <Link2 className="h-2.5 w-2.5" />
                        Linked step
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {bundle.missingTraceIds.length > 0 && (
            <p className="text-[9px] text-phosphor-amber/70">
              {bundle.missingTraceIds.length} linked step
              {bundle.missingTraceIds.length === 1 ? "" : "s"} no longer in
              memory (may still be on disk).
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

/** Compact event rail chips under the diff toolbar. */
export function CausalMiniRail() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const setOpen = useSpokStore((s) => s.setCausalDrawerOpen);
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const open = useSpokStore((s) => s.causalDrawerOpen);

  const fileId = session?.selectedFileId ?? null;
  const bundle = useMemo(() => {
    if (!session || !fileId) return null;
    return getCausalStepsForFile(session, fileId);
  }, [session, fileId]);

  if (!session || !fileId || !bundle || bundle.steps.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b border-phosphor-green/10 px-2 py-1"
      data-testid="causal-mini-rail"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-phosphor-green/40 hover:text-phosphor-cyan"
        title="Toggle Why this change"
      >
        Why
      </button>
      {bundle.steps.slice(0, 8).map((step) => (
        <button
          key={step.nodeId}
          type="button"
          onClick={() => {
            selectTrace(step.nodeId);
            setOpen(true);
          }}
          className={cn(
            "inline-flex max-w-[120px] shrink-0 items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[9px]",
            kindTone(step.kind)
          )}
          title={step.title}
        >
          <KindIcon kind={step.kind} />
          <span className="truncate">{step.toolName || step.title}</span>
        </button>
      ))}
      {bundle.steps.length > 8 && (
        <span className="shrink-0 text-[9px] text-phosphor-green/35">
          +{bundle.steps.length - 8}
        </span>
      )}
    </div>
  );
}
