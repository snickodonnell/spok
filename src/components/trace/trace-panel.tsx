"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { TraceToolbar } from "./trace-toolbar";
import { TraceTree } from "./trace-tree";
import { TraceDetail } from "./trace-detail";

export function TracePanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-phosphor-green/15 px-3 py-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-phosphor-green crt-glow">
          Thinking Trace
        </h2>
        <span className="text-[10px] text-phosphor-green/40">LIVE</span>
      </div>
      <TraceToolbar />
      <Group orientation="vertical" className="flex-1">
        <Panel defaultSize={62} minSize={25}>
          <TraceTree />
        </Panel>
        <Separator className="h-1 bg-phosphor-green/15 hover:bg-phosphor-green/40 transition-colors" />
        <Panel defaultSize={38} minSize={15}>
          <div className="h-full border-t border-phosphor-green/15">
            <div className="border-b border-phosphor-green/10 px-3 py-1 text-[10px] uppercase tracking-widest text-phosphor-green/40">
              Detail
            </div>
            <div className="h-[calc(100%-24px)]">
              <TraceDetail />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
