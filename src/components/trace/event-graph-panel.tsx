"use client";

import { TraceTree } from "./trace-tree";
import { TraceToolbar } from "./trace-toolbar";
import { TraceDetail } from "./trace-detail";
import { useSpokStore } from "@/lib/store";
import { getFilesForTrace } from "@/lib/causal-links";
import { Button } from "@/components/ui/button";
import { FileCode2 } from "lucide-react";
import { useMemo } from "react";

/**
 * Full event graph inspector (tools, plans, system, errors) — one click from Thinking.
 */
export function EventGraphPanel() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const selectFile = useSpokStore((s) => s.selectFile);
  const setWorkspaceRightTab = useSpokStore((s) => s.setWorkspaceRightTab);
  const setCausalDrawerOpen = useSpokStore((s) => s.setCausalDrawerOpen);

  const linkedFiles = useMemo(() => {
    if (!session?.selectedTraceId) return [];
    return getFilesForTrace(session, session.selectedTraceId);
  }, [session]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="event-graph-panel">
      <div className="shrink-0 border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-phosphor-green/80">
          Event graph
        </h2>
        <p className="mt-0.5 text-[10px] text-phosphor-green/40">
          Tools, plans, files, and system events
        </p>
      </div>
      <TraceToolbar />
      <div className="min-h-0 flex-1 overflow-hidden">
        <TraceTree />
      </div>
      {linkedFiles.length > 0 && (
        <div className="shrink-0 border-t border-phosphor-green/15 px-2 py-1.5">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-phosphor-cyan/60">
            Touched files
          </div>
          <div className="flex flex-wrap gap-1">
            {linkedFiles.map((f) => (
              <Button
                key={f.id}
                variant="outline"
                size="sm"
                className="h-6 max-w-full gap-1 text-[10px]"
                onClick={() => {
                  selectFile(f.id);
                  setWorkspaceRightTab("changes");
                  setCausalDrawerOpen(true);
                }}
              >
                <FileCode2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{f.path}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="max-h-[40%] shrink-0 overflow-auto border-t border-phosphor-green/15">
        <TraceDetail />
      </div>
    </div>
  );
}
