"use client";

import type { ComponentType } from "react";
import { Play, Upload, Sparkles, Radio, GitBranch, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpokStore } from "@/lib/store";
import { SAMPLES } from "@/lib/samples";
import { playEvents } from "@/lib/playback";
import { toast } from "sonner";

export function WelcomeScreen() {
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);

  const playSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.meta.id === id);
    if (!sample) return;
    const sessionId = createSession({
      name: sample.meta.name,
      source: "sample",
      status: "running",
    });
    toast.message(`Playing: ${sample.meta.name}`);
    playEvents(
      sample.events,
      (ev) => {
        applyStreamEvent(sessionId, ev);
        if (ev.content) appendRawLog(sessionId, `[${ev.type}] ${ev.content.slice(0, 200)}`);
      },
      {
        speed: 1.5,
        onComplete: () => {
          updateSession(sessionId, { status: "completed" });
          toast.success("Sample playback complete");
        },
      }
    );
  };

  return (
    <div className="flex h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-8 p-8">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded border border-phosphor-green/30 bg-phosphor-green/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-phosphor-green">
            <Radio className="h-3 w-3 animate-pulse" />
            Live harness online
          </div>
          <h1 className="font-mono text-3xl font-bold tracking-tight text-phosphor-green crt-glow sm:text-4xl">
            SPOK
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-phosphor-green/55">
            Live harness & visualizer for Grok Build. Watch thinking traces and
            repository diffs stream in real time — phosphor-green, CRT-flavored
            visibility into everything the agent is thinking and changing.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Feature
            icon={Eye}
            title="Thinking traces"
            desc="Expandable live tree of reasoning, tools, plans, and subagents"
          />
          <Feature
            icon={GitBranch}
            title="Repo diffs"
            desc="Monaco side-by-side diffs with file tree, stats, and hunk nav"
          />
          <Feature
            icon={Radio}
            title="Live harness"
            desc="Spawn Grok CLI, stream output, deep-link traces to code changes"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLaunchOpen(true)}>
            <Play className="h-4 w-4" />
            Launch Grok Build
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import / paste
          </Button>
          <Button
            variant="amber"
            onClick={() => playSample(SAMPLES[0].meta.id)}
          >
            <Sparkles className="h-4 w-4" />
            Play demo sample
          </Button>
        </div>

        <div>
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-phosphor-green/40">
            Sample sessions
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((s) => (
              <button
                key={s.meta.id}
                type="button"
                onClick={() => playSample(s.meta.id)}
                className="crt-panel rounded-lg p-4 text-left transition hover:border-phosphor-green/40 hover:shadow-[0_0_20px_rgba(51,255,102,0.1)]"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-phosphor-amber" />
                  <span className="font-mono text-sm text-phosphor-green">
                    {s.meta.name}
                  </span>
                </div>
                <p className="mt-1 text-xs text-phosphor-green/45">
                  {s.meta.description}
                </p>
                <div className="mt-2 flex gap-3 text-[10px] text-phosphor-cyan/60">
                  <span>{s.meta.duration}</span>
                  <span>{s.meta.filesChanged} files</span>
                  <span>{s.meta.toolCalls} tools</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-phosphor-green/30">
          Tip: press <kbd className="rounded border border-phosphor-green/20 px-1">Ctrl+K</kbd> for
          the command palette ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">Ctrl+1</kbd> Unified ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">Ctrl+2</kbd> Trace ·{" "}
          <kbd className="rounded border border-phosphor-green/20 px-1">Ctrl+3</kbd> Diff
        </p>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="crt-panel rounded-lg p-4">
      <Icon className="mb-2 h-5 w-5 text-phosphor-cyan" />
      <div className="font-mono text-sm text-phosphor-green">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-phosphor-green/45">{desc}</p>
    </div>
  );
}
