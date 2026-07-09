"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import { useSpokStore } from "@/lib/store";
import { TracePanel } from "@/components/trace/trace-panel";
import { DiffPanel } from "@/components/diff/diff-panel";
import { LogPanel } from "@/components/session/log-panel";
import { OverviewPanel } from "@/components/session/overview-panel";
import { PromptComposer } from "@/components/session/prompt-composer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileCode2, ScrollText, BarChart3 } from "lucide-react";
import { useState } from "react";

type RightTab = "diff" | "log" | "overview";

/**
 * Primary live harness surface:
 * - Thinking trace permanently on the left
 * - Diff / log / overview on the right
 * - Prompt + slash commands docked at the bottom
 */
export function Workspace() {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const [rightTab, setRightTab] = useState<RightTab>("diff");

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-phosphor-green/40">
        Open a workspace to start
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize={40} minSize={22}>
          <div className="h-full border-r border-phosphor-green/10">
            <TracePanel />
          </div>
        </Panel>
        <Separator className="w-1 bg-phosphor-green/15 hover:bg-phosphor-green/40 transition-colors" />
        <Panel defaultSize={60} minSize={30}>
          <div className="flex h-full min-h-0 flex-col">
            <Tabs
              value={rightTab}
              onValueChange={(v) => setRightTab(v as RightTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center border-b border-phosphor-green/15 px-2 py-1">
                <TabsList className="h-8">
                  <TabsTrigger value="diff" className="gap-1 text-[10px]">
                    <FileCode2 className="h-3 w-3" />
                    Diff
                  </TabsTrigger>
                  <TabsTrigger value="log" className="gap-1 text-[10px]">
                    <ScrollText className="h-3 w-3" />
                    Log
                  </TabsTrigger>
                  <TabsTrigger value="overview" className="gap-1 text-[10px]">
                    <BarChart3 className="h-3 w-3" />
                    Overview
                  </TabsTrigger>
                </TabsList>
                <span className="ml-auto truncate font-mono text-[10px] text-phosphor-green/35">
                  {session.config.cwd}
                </span>
              </div>
              <TabsContent value="diff" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
                <div className="h-full">
                  <DiffPanel />
                </div>
              </TabsContent>
              <TabsContent value="log" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
                <div className="h-full">
                  <LogPanel />
                </div>
              </TabsContent>
              <TabsContent
                value="overview"
                className="mt-0 min-h-0 flex-1 overflow-auto data-[state=inactive]:hidden"
              >
                <OverviewPanel />
              </TabsContent>
            </Tabs>
          </div>
        </Panel>
      </Group>
      <PromptComposer />
    </div>
  );
}
