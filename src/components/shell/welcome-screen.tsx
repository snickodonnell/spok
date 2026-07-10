"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  Play,
  Upload,
  Sparkles,
  Radio,
  GitBranch,
  Eye,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpokStore } from "@/lib/store";
import { SAMPLES } from "@/lib/samples";
import { playEvents } from "@/lib/playback";
import { localFetch } from "@/lib/local-api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CliStatus = {
  command: string;
  found: boolean;
  version: string | null;
  authGuidance?: string;
};

/**
 * First-run surface: repo launcher + sample path with CLI readiness visible
 * before a session exists.
 */
export function WelcomeScreen() {
  const setLaunchOpen = useSpokStore((s) => s.setLaunchOpen);
  const setImportOpen = useSpokStore((s) => s.setImportOpen);
  const createSession = useSpokStore((s) => s.createSession);
  const applyStreamEvent = useSpokStore((s) => s.applyStreamEvent);
  const appendRawLog = useSpokStore((s) => s.appendRawLog);
  const updateSession = useSpokStore((s) => s.updateSession);
  const sessions = useSpokStore((s) => s.sessions);
  const setActiveSession = useSpokStore((s) => s.setActiveSession);
  const setViewMode = useSpokStore((s) => s.setViewMode);
  const setProductMode = useSpokStore((s) => s.setProductMode);
  const appPermissionMode = useSpokStore((s) => s.appPermissionMode);

  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliLoading, setCliLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCliLoading(true);
    void localFetch("/api/runtime/cli-status?command=grok")
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { status?: CliStatus };
        if (!cancelled && data.status) setCli(data.status);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCliLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recent = Object.values(sessions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  const playSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.meta.id === id);
    if (!sample) return;
    const sessionId = createSession({
      name: sample.meta.name,
      source: "sample",
      status: "running",
    });
    setProductMode("run");
    toast.message(`Playing: ${sample.meta.name}`);
    playEvents(
      sample.events,
      (ev) => {
        applyStreamEvent(sessionId, ev);
        if (ev.content)
          appendRawLog(sessionId, `[${ev.type}] ${ev.content.slice(0, 200)}`);
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
    <div className="flex h-full overflow-auto" data-testid="welcome-screen">
      <div className="mx-auto flex w-full max-w-4xl flex-col justify-center gap-8 p-8">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded border border-phosphor-green/25 bg-phosphor-green/8 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-phosphor-green/80">
            <Radio className="h-3 w-3" />
            Grok Build workbench
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-phosphor-green sm:text-4xl">
            SPOK
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-phosphor-green/55">
            Open a repo to run Grok with a live thinking stream, linked diffs,
            and review tools — or play a sample without installing the CLI.
          </p>
        </div>

        {/* Readiness strip before launch */}
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-phosphor-green/15 bg-black/30 px-3 py-2.5"
          data-testid="welcome-readiness"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              cliLoading
                ? "text-phosphor-green/40"
                : cli?.found
                  ? "text-phosphor-green/80"
                  : "text-phosphor-amber"
            )}
          >
            {cliLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : cli?.found ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" />
            )}
            <Terminal className="h-3.5 w-3.5 opacity-70" />
            <span className="font-mono">
              {cliLoading
                ? "Checking Grok CLI…"
                : cli?.found
                  ? `Grok CLI ready${cli.version ? ` · ${cli.version}` : ""}`
                  : "Grok CLI not found — samples & import still work"}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-phosphor-green/50">
            <Shield className="h-3.5 w-3.5" />
            Permission:{" "}
            <span className="font-mono text-phosphor-cyan/80">
              {appPermissionMode}
            </span>
          </span>
          <span className="text-[10px] text-phosphor-green/35">
            Opening a repo records workspace trust for privileged APIs
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Feature
            icon={Eye}
            title="Thinking + events"
            desc="Readable thought stream with a full event graph one click away"
          />
          <Feature
            icon={GitBranch}
            title="Changes + review"
            desc="Diffs linked to agent steps, stage/commit without leaving Spok"
          />
          <Feature
            icon={Radio}
            title="Live harness"
            desc="Spawn Grok CLI, queue follow-ups, isolate background work"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => setLaunchOpen(true)}
            data-testid="welcome-open-repo"
          >
            <Play className="h-4 w-4" />
            Open repo
          </Button>
          <Button
            size="lg"
            variant="amber"
            onClick={() => playSample(SAMPLES[0].meta.id)}
            data-testid="welcome-play-sample"
          >
            <Sparkles className="h-4 w-4" />
            Play sample
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="rounded-lg border border-phosphor-cyan/25 bg-phosphor-cyan/5 p-4">
            <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-phosphor-cyan/70">
              Recent repos
            </h2>
            <div className="flex flex-col gap-1.5">
              {recent.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveSession(s.id);
                    setViewMode("workspace");
                    setProductMode("run");
                  }}
                  className="flex items-center justify-between rounded border border-phosphor-green/15 bg-black/30 px-3 py-2 text-left transition hover:border-phosphor-cyan/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-phosphor-green">
                      {s.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-phosphor-green/40">
                      {s.config.cwd || s.source}
                      {s.eventCount ? ` · ${s.eventCount} events` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-phosphor-cyan/60">
                    {s.source === "resume" ? "restored" : s.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-phosphor-green/40">
            Sample sessions
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {SAMPLES.map((s) => (
              <button
                key={s.meta.id}
                type="button"
                onClick={() => playSample(s.meta.id)}
                className="rounded-lg border border-phosphor-green/15 bg-black/25 p-3 text-left transition hover:border-phosphor-green/35 hover:bg-phosphor-green/5"
              >
                <div className="text-sm font-medium text-phosphor-green">
                  {s.meta.name}
                </div>
                <div className="mt-1 text-[11px] text-phosphor-green/45">
                  {s.meta.description}
                </div>
                <div className="mt-2 font-mono text-[9px] text-phosphor-green/30">
                  {s.meta.duration} · {s.meta.filesChanged} files ·{" "}
                  {s.meta.toolCalls} tools
                </div>
              </button>
            ))}
          </div>
        </div>
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
    <div className="rounded-lg border border-phosphor-green/12 bg-black/20 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-phosphor-green/80">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{title}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-phosphor-green/45">{desc}</p>
    </div>
  );
}
