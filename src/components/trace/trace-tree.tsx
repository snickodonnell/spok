"use client";

import { useMemo, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ChevronDown, Link2 } from "lucide-react";
import { useSpokStore } from "@/lib/store";
import type { TraceNode } from "@/lib/types";
import { cn, formatDuration, formatRelativeTime, truncate } from "@/lib/utils";
import { TraceNodeIcon } from "./trace-node-icon";
import { Badge } from "@/components/ui/badge";

function flattenVisible(
  roots: string[],
  nodes: Record<string, TraceNode>,
  expanded: Set<string>,
  filter: {
    search: string;
    types: string[];
    status: string[];
    showOnlyLinked: boolean;
  }
): TraceNode[] {
  const result: TraceNode[] = [];
  const q = filter.search.trim().toLowerCase();

  function matches(n: TraceNode): boolean {
    if (filter.types.length && !filter.types.includes(n.type)) return false;
    if (filter.status.length && n.status && !filter.status.includes(n.status)) return false;
    if (filter.showOnlyLinked && n.links.length === 0) return false;
    if (!q) return true;
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      (n.toolName?.toLowerCase().includes(q) ?? false)
    );
  }

  function anyDescendantMatches(id: string): boolean {
    const n = nodes[id];
    if (!n) return false;
    if (matches(n)) return true;
    return n.children.some(anyDescendantMatches);
  }

  function walk(id: string) {
    const n = nodes[id];
    if (!n) return;
    const selfMatch = matches(n);
    const childMatch = n.children.some(anyDescendantMatches);
    if (!selfMatch && !childMatch) return;
    result.push(n);
    if (expanded.has(id) || q) {
      for (const c of n.children) walk(c);
    }
  }

  for (const r of roots) walk(r);
  return result;
}

function statusBadge(status?: TraceNode["status"]) {
  if (!status) return null;
  const variant =
    status === "error"
      ? "error"
      : status === "running"
        ? "amber"
        : status === "success"
          ? "success"
          : "muted";
  return (
    <Badge variant={variant} className="ml-1">
      {status}
    </Badge>
  );
}

export function TraceTree() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const expandedNodeIds = useSpokStore((s) => s.expandedNodeIds);
  const toggleExpanded = useSpokStore((s) => s.toggleExpanded);
  const selectTrace = useSpokStore((s) => s.selectTrace);
  const navigateTraceLink = useSpokStore((s) => s.navigateTraceLink);
  const filter = useSpokStore((s) => s.traceFilter);
  const parentRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => {
    if (!session) return [];
    return flattenVisible(session.rootTraceIds, session.nodes, expandedNodeIds, filter);
  }, [session, expandedNodeIds, filter]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  // Auto-scroll to selected / latest when running
  useEffect(() => {
    if (!session?.selectedTraceId || !session.config.autoScroll) return;
    const idx = flat.findIndex((n) => n.id === session.selectedTraceId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    }
  }, [session?.selectedTraceId, session?.config.autoScroll, flat, virtualizer]);

  const onKeyNav = useCallback(
    (e: React.KeyboardEvent, node: TraceNode, index: number) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = flat[index + 1];
        if (next) selectTrace(next.id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = flat[index - 1];
        if (prev) selectTrace(prev.id);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (node.children.length && !expandedNodeIds.has(node.id)) {
          toggleExpanded(node.id);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (expandedNodeIds.has(node.id)) toggleExpanded(node.id);
        else if (node.parentId) selectTrace(node.parentId);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (node.links.length) navigateTraceLink(node.id);
      }
    },
    [flat, selectTrace, toggleExpanded, expandedNodeIds, navigateTraceLink]
  );

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-phosphor-green/40">
        No active session
      </div>
    );
  }

  if (flat.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-sm text-phosphor-green/50">No trace nodes yet</div>
        <div className="text-xs text-phosphor-green/30">
          Launch a session or load a sample to see thinking traces live
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const node = flat[vRow.index];
          const hasChildren = node.children.length > 0;
          const isExpanded = expandedNodeIds.has(node.id);
          const isSelected = session.selectedTraceId === node.id;
          const hasLink = node.links.some((l) => l.kind === "file");

          return (
            <div
              key={node.id}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <button
                type="button"
                onClick={() => selectTrace(node.id)}
                onKeyDown={(e) => onKeyNav(e, node, vRow.index)}
                className={cn(
                  "group flex w-full items-start gap-1 border-l-2 px-2 py-1.5 text-left transition-colors",
                  isSelected
                    ? "border-phosphor-green bg-phosphor-green/10 shadow-[inset_0_0_20px_rgba(51,255,102,0.06)]"
                    : "border-transparent hover:bg-phosphor-green/5 hover:border-phosphor-green/20"
                )}
                style={{ paddingLeft: 8 + node.depth * 16 }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
                  onClick={(e) => {
                    if (hasChildren) {
                      e.stopPropagation();
                      toggleExpanded(node.id);
                    }
                  }}
                >
                  {hasChildren ? (
                    isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-phosphor-green/60" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-phosphor-green/60" />
                    )
                  ) : (
                    <span className="h-3.5 w-3.5" />
                  )}
                </span>
                <TraceNodeIcon type={node.type} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-xs font-medium",
                        isSelected ? "text-phosphor-green crt-glow" : "text-phosphor-green/85"
                      )}
                    >
                      {node.title}
                    </span>
                    {statusBadge(node.status)}
                    {hasLink && (
                      <Link2
                        className="h-3 w-3 shrink-0 text-phosphor-cyan cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateTraceLink(node.id);
                        }}
                      />
                    )}
                    {node.durationMs != null && (
                      <span className="ml-auto shrink-0 text-[10px] text-phosphor-green/35">
                        {formatDuration(node.durationMs)}
                      </span>
                    )}
                  </div>
                  {node.summary && (
                    <div className="truncate text-[11px] text-phosphor-green/40">
                      {truncate(node.summary, 100)}
                    </div>
                  )}
                </div>
                <span className="mt-0.5 shrink-0 text-[10px] text-phosphor-green/30 opacity-0 group-hover:opacity-100">
                  {formatRelativeTime(node.timestamp)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
