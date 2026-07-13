"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EffectivePolicySummary } from "@/lib/security/effective-policy";

/**
 * Compact effective-policy presentation for the session composer.
 * Expandable provider detail + precedence. Persistent elevated risk chip
 * while high-risk provider/app modes are active (not toast-only).
 */
export function EffectivePolicySummaryView({
  summary,
  className,
}: {
  summary: EffectivePolicySummary;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const riskBadgeVariant =
    summary.riskTier === "critical" || summary.riskTier === "high"
      ? "error"
      : summary.riskTier === "medium"
        ? "amber"
        : "muted";

  return (
    <div
      className={cn("min-w-0 max-w-full", className)}
      data-testid="effective-policy-summary"
      data-elevated={summary.elevated ? "true" : "false"}
      data-risk={summary.riskTier}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left font-mono text-[10px] transition-colors",
            summary.elevated
              ? "border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-400/60"
              : "border-phosphor-green/20 bg-black/40 text-phosphor-green/70 hover:border-phosphor-cyan/40 hover:text-phosphor-cyan"
          )}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="effective-policy-toggle"
          title="Effective permission policy — click for detail and precedence"
        >
          {summary.elevated ? (
            <ShieldAlert className="h-3 w-3 shrink-0 text-red-400" />
          ) : (
            <Shield className="h-3 w-3 shrink-0 text-phosphor-green/50" />
          )}
          <span className="truncate">{summary.headline}</span>
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
          )}
        </button>

        <Badge variant={riskBadgeVariant} className="text-[8px]">
          {summary.riskLabel}
        </Badge>

        {summary.elevated && (
          <Badge
            variant="error"
            className="text-[8px]"
            data-testid="elevated-risk-indicator"
            title={summary.riskExplanation}
          >
            Elevated active
          </Badge>
        )}
      </div>

      {open && (
        <div
          className="mt-1.5 max-w-xl rounded border border-phosphor-green/15 bg-black/50 px-2.5 py-2 text-[10px] leading-relaxed text-phosphor-green/70"
          data-testid="effective-policy-detail"
        >
          <p className="mb-1.5 text-phosphor-green/85">{summary.riskExplanation}</p>
          <dl className="mb-2 grid gap-0.5 font-mono">
            {summary.providerDetail.map((row) => (
              <div key={row.key} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-phosphor-green/40">{row.key}</dt>
                <dd className="truncate text-phosphor-green/75" title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mb-1 text-[9px] uppercase tracking-wider text-phosphor-amber/70">
            Precedence
          </p>
          <ol className="list-decimal space-y-0.5 pl-3.5 text-phosphor-green/60">
            {summary.precedence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
