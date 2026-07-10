"use client";

import { ThinkingStream } from "./thinking-stream";

/**
 * Thinking feed = pure agent thought text.
 * Tools, plans, and system events live in the Event graph (left pane toggle).
 */
export function TracePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="thinking-panel">
      <div className="min-h-0 flex-1">
        <ThinkingStream />
      </div>
    </div>
  );
}
