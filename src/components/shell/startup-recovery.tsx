"use client";

import { AlertTriangle, RefreshCw, SkipForward, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpokStore } from "@/lib/store";
import type { SessionHydrationState } from "@/hooks/use-session-hydration";

export function StartupRecovery({
  state,
  onRetry,
  onContinue,
  compact = false,
}: {
  state: Extract<SessionHydrationState, { phase: "recovery" }>;
  onRetry: () => void;
  onContinue: () => void;
  compact?: boolean;
}) {
  const setDiagnosticsOpen = useSpokStore((s) => s.setDiagnosticsOpen);

  return (
    <section
      className="flex h-full min-h-[20rem] flex-col items-center justify-center bg-crt-bg px-5 text-phosphor-green"
      data-testid="startup-recovery"
      data-shell-usable="true"
      role="alert"
      aria-labelledby="startup-recovery-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-phosphor-amber/40 bg-phosphor-amber/5 p-5 shadow-xl shadow-black/20">
        <AlertTriangle className="mb-3 h-6 w-6 text-phosphor-amber" aria-hidden />
        <h1 id="startup-recovery-title" className="text-base font-semibold">
          Saved sessions could not be restored
        </h1>
        <p className="mt-2 text-sm text-phosphor-green/80">
          <span className="font-medium text-phosphor-green">{state.operation}:</span>{" "}
          {state.message}
        </p>
        <p className="mt-2 text-xs text-phosphor-green/65">
          No run was stopped and no workspace trust or execution permission changed.
        </p>
        <div className={compact ? "mt-5 grid gap-2" : "mt-5 flex flex-wrap gap-2"}>
          <Button onClick={onRetry} data-testid="startup-retry">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          <Button
            variant="secondary"
            onClick={onContinue}
            data-testid="startup-continue"
          >
            <SkipForward className="h-4 w-4" />
            Continue without restored sessions
          </Button>
          <Button
            variant="outline"
            onClick={() => setDiagnosticsOpen(true)}
            data-testid="startup-diagnostics"
          >
            <Stethoscope className="h-4 w-4" />
            Diagnostics
          </Button>
        </div>
      </div>
    </section>
  );
}
