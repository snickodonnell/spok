"use client";

import { ThinkingStream } from "./thinking-stream";

/**
 * Thinking Trace = pure agent thought text only.
 * Tools, system events, icons, and wire metadata live in Log / other panels.
 */
export function TracePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-phosphor-green crt-glow">
          Thinking
        </h2>
      </div>
      <div className="min-h-0 flex-1">
        <ThinkingStream />
      </div>
    </div>
  );
}
