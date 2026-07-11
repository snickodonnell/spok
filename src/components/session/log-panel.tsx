"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSpokStore } from "@/lib/store";

/**
 * Virtualized raw log — long sessions can accumulate 10k+ lines.
 */
export function LogPanel() {
  const lines = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId!]?.rawLog : undefined
  ) ?? [];
  const autoScroll = useSpokStore((s) => {
    const id = s.activeSessionId;
    return id ? s.sessions[id]?.config.autoScroll !== false : true;
  });
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 24,
  });

  useEffect(() => {
    if (!autoScroll || lines.length === 0) return;
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [lines.length, autoScroll, virtualizer]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="log-panel">
      <div className="shrink-0 border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="panel-title text-phosphor-green">Raw Log</h2>
        <p className="mt-0.5 text-[10px] text-phosphor-green/35">
          Stream envelopes, tool payloads, and wire format — thinking prose is
          in the Trace
          {lines.length > 0 && (
            <span className="ml-1 font-mono text-phosphor-green/45">
              · {lines.length} lines
            </span>
          )}
        </p>
      </div>
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto bg-black/50 p-3 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-phosphor-green/35">No log output captured</div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const line = lines[row.index];
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full whitespace-pre-wrap break-all text-phosphor-green/75"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <span className="mr-2 select-none text-phosphor-green/25">
                    {String(row.index + 1).padStart(4, " ")}
                  </span>
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
