"use client";

import { useState } from "react";
import { useSpokStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TraceNodeIcon } from "./trace-node-icon";
import { formatDuration } from "@/lib/utils";
import {
  FileCode2,
  Clock,
  Link2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import {
  hasTechnicalMeta,
  isProseTraceType,
  traceDetailBody,
  traceKindLabel,
  tracePrimaryText,
} from "@/lib/trace-display";
import { toast } from "sonner";

/**
 * Reading pane for the selected trace step.
 * Prose (thinking, replies, goals) is the hero; type badges and raw meta are demoted.
 */
export function TraceDetail() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const [showTech, setShowTech] = useState(false);
  const [copied, setCopied] = useState(false);

  const node = session?.selectedTraceId
    ? session.nodes[session.selectedTraceId]
    : null;

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
        <p className="text-xs text-phosphor-green/40">
          Select a step to read the agent&apos;s thinking
        </p>
        <p className="max-w-[16rem] text-[10px] text-phosphor-green/25">
          The tree shows thought text inline; this pane expands the full write-up.
        </p>
      </div>
    );
  }

  const prose = isProseTraceType(node.type);
  const body = traceDetailBody(node);
  const primary = tracePrimaryText(node);
  const kind = traceKindLabel(node);
  const tech = hasTechnicalMeta(node);

  const copyBody = async () => {
    const text = body || primary;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <ScrollArea className="h-full">
      <div className="flex h-full min-h-0 flex-col">
        {/* Compact chrome */}
        <div className="flex items-start gap-2 border-b border-phosphor-green/10 px-3 py-2">
          <TraceNodeIcon type={node.type} size={16} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-phosphor-cyan/80">
                {kind}
              </span>
              {node.status && node.status !== "success" && (
                <Badge
                  variant={
                    node.status === "error"
                      ? "error"
                      : node.status === "running"
                        ? "amber"
                        : "muted"
                  }
                  className="text-[9px]"
                >
                  {node.status}
                </Badge>
              )}
              {node.toolName && !prose && (
                <span className="font-mono text-[10px] text-phosphor-amber/70">
                  {node.toolName}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-phosphor-green/35">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {new Date(node.timestamp).toLocaleTimeString()}
              </span>
              {node.durationMs != null && (
                <span>{formatDuration(node.durationMs)}</span>
              )}
            </div>
          </div>
          {(body || primary) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title="Copy text"
              onClick={() => void copyBody()}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-phosphor-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>

        {/* Main reading surface */}
        <div className="flex-1 px-3 py-3">
          {prose ? (
            <div className="space-y-2">
              {body || primary ? (
                <div
                  className="whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-phosphor-green/90"
                  style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
                >
                  {body || primary}
                </div>
              ) : (
                <p className="text-xs italic text-phosphor-green/35">
                  No thought text captured for this step.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[13px] font-medium leading-snug text-phosphor-green/90">
                {primary}
              </p>
              {body && body !== primary && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-phosphor-green/10 bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-phosphor-green/60">
                  {body}
                </pre>
              )}
              <p className="text-[10px] text-phosphor-green/30">
                Raw stream lines and tool payloads live in the Log tab.
              </p>
            </div>
          )}

          {node.links.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-phosphor-green/40">
                Linked files
              </div>
              <div className="space-y-1">
                {node.links.map((link) => (
                  <Button
                    key={link.targetId + (link.path ?? "")}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 font-mono text-xs"
                    onClick={() => {
                      if (link.kind === "file") {
                        selectFile(link.targetId);
                        setViewMode("unified");
                      }
                    }}
                  >
                    {link.kind === "file" ? (
                      <FileCode2 className="h-3.5 w-3.5 text-phosphor-cyan" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    <span className="truncate">
                      {link.label ?? link.path ?? link.targetId}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Technical dump — collapsed; full fidelity stays in Log */}
          {(tech || node.children.length > 0) && (
            <div className="mt-4 border-t border-phosphor-green/10 pt-2">
              <button
                type="button"
                className="flex w-full items-center gap-1 py-1 text-left font-mono text-[9px] uppercase tracking-widest text-phosphor-green/35 hover:text-phosphor-green/55"
                onClick={() => setShowTech((v) => !v)}
              >
                {showTech ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Technical details
                {node.children.length > 0 && (
                  <span className="normal-case tracking-normal text-phosphor-green/25">
                    · {node.children.length} child
                    {node.children.length === 1 ? "" : "ren"}
                  </span>
                )}
              </button>
              {showTech && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="muted" className="text-[9px]">
                      {node.type}
                    </Badge>
                    <Badge variant="muted" className="text-[9px]">
                      id {node.id}
                    </Badge>
                    <Badge variant="muted" className="text-[9px]">
                      depth {node.depth}
                    </Badge>
                    {node.title && node.title !== kind && (
                      <Badge variant="muted" className="text-[9px]">
                        {node.title}
                      </Badge>
                    )}
                  </div>
                  {node.meta && Object.keys(node.meta).length > 0 && (
                    <pre className="max-h-40 overflow-auto rounded border border-phosphor-green/10 bg-black/40 p-2 font-mono text-[10px] text-phosphor-cyan/55">
                      {JSON.stringify(node.meta, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
