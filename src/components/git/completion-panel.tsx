"use client";

import {
  AlertTriangle,
  Check,
  Circle,
  ClipboardCopy,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
  LockKeyhole,
  Route,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  HandoffActionId,
  HandoffFlow,
  HandoffStepStatus,
} from "@/lib/handoff-flow";

export function CompletionPanel({
  flow,
  busy,
  planMode,
  onAction,
  onCopySummary,
}: {
  flow: HandoffFlow;
  busy: boolean;
  planMode: boolean;
  onAction: (action: HandoffActionId) => void;
  onCopySummary: () => void;
}) {
  const actionBlocked =
    busy ||
    flow.nextAction.disabled ||
    (planMode && flow.nextAction.privileged);

  return (
    <section
      className="border-b border-phosphor-green/15 bg-[linear-gradient(135deg,rgba(51,255,102,0.055),transparent_52%)] p-3"
      aria-label="Completion path"
      data-testid="completion-panel"
    >
      <div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-phosphor-green/45">
            <Route className="h-3.5 w-3.5 text-phosphor-cyan" />
            Completion path
            <span className="normal-case tracking-normal text-phosphor-green/30">
              · {flow.workspaceLabel}
              {flow.branch ? ` · ${flow.branch}` : ""}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-phosphor-green">
            {flow.headline}
          </p>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-phosphor-green/45">
            {flow.nextAction.detail}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[10px]"
            onClick={onCopySummary}
            title="Copy trace-linked review summary"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            Copy summary
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 min-w-36 gap-1.5 text-[10px]"
            disabled={actionBlocked}
            onClick={() => onAction(flow.nextAction.id)}
            title={
              planMode && flow.nextAction.privileged
                ? "Plan mode keeps Git writes disabled"
                : flow.nextAction.detail
            }
            data-testid="completion-primary-action"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : planMode && flow.nextAction.privileged ? (
              <LockKeyhole className="h-3.5 w-3.5" />
            ) : (
              <ActionIcon status={flow.steps.find((step) => step.status === "active")?.status} />
            )}
            {flow.nextAction.label}
          </Button>
        </div>
      </div>

      {flow.outcome && (
        <div
          className="mt-3 rounded border border-phosphor-cyan/20 bg-black/20 px-2.5 py-2"
          aria-label="Durable handoff evidence"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[9px] text-phosphor-green/50">
            <span className="font-medium uppercase tracking-[0.14em] text-phosphor-cyan/70">
              Recorded evidence
            </span>
            {flow.outcome.commit && (
              <span className="inline-flex items-center gap-1" title={flow.outcome.commit.oid}>
                <GitCommitHorizontal className="h-3 w-3 text-phosphor-green" />
                commit <code>{flow.outcome.commit.oid.slice(0, 9)}</code>
              </span>
            )}
            {flow.outcome.push && (
              <span className="inline-flex items-center gap-1">
                <Upload className="h-3 w-3 text-phosphor-green" />
                pushed {flow.outcome.push.branch || flow.outcome.branch || "branch"}
              </span>
            )}
            {flow.outcome.pullRequest && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <GitPullRequest className="h-3 w-3 shrink-0 text-phosphor-green" />
                {flow.outcome.pullRequest.url ? (
                  <a
                    href={flow.outcome.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-52 truncate text-phosphor-cyan hover:underline"
                    title={flow.outcome.pullRequest.url}
                  >
                    {flow.outcome.pullRequest.number
                      ? `PR #${flow.outcome.pullRequest.number}`
                      : "Pull request"}
                  </a>
                ) : (
                  <span>Pull request created</span>
                )}
              </span>
            )}
          </div>
          {flow.outcome.failure && (
            <p className="mt-1.5 flex items-start gap-1 text-[9px] leading-relaxed text-phosphor-amber">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {flow.outcome.failure.action.replace("_", " ")} failed · {flow.outcome.failure.message}
            </p>
          )}
          <p className="mt-1 text-[8px] text-phosphor-green/30">
            Snapshot: {flow.outcome.readiness.validationPassed} validation passed ·{" "}
            {flow.outcome.readiness.reviewIssueCount} review findings ·{" "}
            {flow.outcome.jobId ? `job ${flow.outcome.jobId.slice(0, 9)}` : "interactive session"}
          </p>
        </div>
      )}

      <ol className="mt-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4" aria-label="Handoff stages">
        {flow.steps.map((step, index) => (
          <li
            key={step.id}
            className={cn(
              "relative min-w-0 rounded border px-2 py-1.5",
              step.status === "complete" &&
                "border-phosphor-green/20 bg-phosphor-green/5",
              step.status === "active" &&
                "border-phosphor-cyan/35 bg-phosphor-cyan/8",
              step.status === "blocked" &&
                "border-phosphor-amber/25 bg-phosphor-amber/5",
              step.status === "pending" &&
                "border-phosphor-green/10 bg-black/15"
            )}
          >
            <div className="flex items-center gap-1.5">
              <StepIcon status={step.status} />
              <span
                className={cn(
                  "text-[10px] font-medium",
                  step.status === "active"
                    ? "text-phosphor-cyan"
                    : step.status === "blocked"
                      ? "text-phosphor-amber"
                      : step.status === "complete"
                        ? "text-phosphor-green/80"
                        : "text-phosphor-green/35"
                )}
              >
                {index + 1}. {step.label}
              </span>
            </div>
            <p className="mt-0.5 truncate pl-[18px] text-[9px] text-phosphor-green/35" title={step.detail}>
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepIcon({ status }: { status: HandoffStepStatus }) {
  if (status === "complete") {
    return <Check className="h-3 w-3 text-phosphor-green" aria-hidden />;
  }
  if (status === "blocked") {
    return <AlertTriangle className="h-3 w-3 text-phosphor-amber" aria-hidden />;
  }
  return (
    <Circle
      className={cn(
        "h-3 w-3",
        status === "active" ? "fill-phosphor-cyan/25 text-phosphor-cyan" : "text-phosphor-green/20"
      )}
      aria-hidden
    />
  );
}

function ActionIcon({ status }: { status?: HandoffStepStatus }) {
  return status === "blocked" ? (
    <AlertTriangle className="h-3.5 w-3.5" />
  ) : (
    <Check className="h-3.5 w-3.5" />
  );
}
