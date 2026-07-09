"use client";

import { useSpokStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TraceNodeIcon } from "./trace-node-icon";
import { formatDuration } from "@/lib/utils";
import { FileCode2, Clock, Link2 } from "lucide-react";

export function TraceDetail() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const setViewMode = useSpokStore((s) => s.setViewMode);

  const node = session?.selectedTraceId
    ? session.nodes[session.selectedTraceId]
    : null;

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-phosphor-green/35">
        Select a trace step to inspect details
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <div className="flex items-start gap-2">
          <TraceNodeIcon type={node.type} size={18} />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-sm text-phosphor-green crt-glow">
              {node.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="cyan">{node.type}</Badge>
              {node.status && (
                <Badge
                  variant={
                    node.status === "error"
                      ? "error"
                      : node.status === "running"
                        ? "amber"
                        : "success"
                  }
                >
                  {node.status}
                </Badge>
              )}
              {node.toolName && <Badge variant="amber">{node.toolName}</Badge>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-phosphor-green/45">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(node.timestamp).toLocaleTimeString()}
          </span>
          {node.durationMs != null && (
            <span>{formatDuration(node.durationMs)}</span>
          )}
          <span>depth {node.depth}</span>
        </div>

        <div className="rounded border border-phosphor-green/15 bg-black/40 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
            Content
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-phosphor-green/80">
            {node.content || "—"}
          </pre>
        </div>

        {node.links.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-phosphor-green/40">
              Linked changes
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
                  <span className="truncate">{link.label ?? link.path ?? link.targetId}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {node.meta && Object.keys(node.meta).length > 0 && (
          <div className="rounded border border-phosphor-green/15 bg-black/40 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
              Meta
            </div>
            <pre className="overflow-auto font-mono text-[11px] text-phosphor-cyan/70">
              {JSON.stringify(node.meta, null, 2)}
            </pre>
          </div>
        )}

        {node.children.length > 0 && (
          <div className="text-[11px] text-phosphor-green/40">
            {node.children.length} child step{node.children.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
