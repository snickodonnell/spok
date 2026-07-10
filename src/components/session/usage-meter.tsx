"use client";

import { useMemo } from "react";
import { useSpokStore } from "@/lib/store";
import {
  buildSessionUsage,
  formatTokenCount,
  usageToneStyles,
  type UsageMeterModel,
  type UsageTone,
} from "@/lib/usage";
import { cn } from "@/lib/utils";
import { Gauge } from "lucide-react";

type Props = {
  /** Compact chip for metrics strip (default). */
  compact?: boolean;
  className?: string;
  contextLimit?: number;
  show?: boolean;
};

/**
 * Unintrusive usage feedback: thin meter + counts.
 * Colors shift calm → notice → caution → warn → critical as usage nears limit.
 */
export function UsageMeter({
  compact = true,
  className,
  contextLimit,
  show = true,
}: Props) {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );

  // Session object is replaced on each store update for that session, so it is
  // a sufficient dependency for usage recompute without listing every field.
  const snapshot = useMemo(() => {
    if (!session) return null;
    return buildSessionUsage(session, { contextLimit });
  }, [session, contextLimit]);

  if (!show || !session || !snapshot) return null;

  // Hide empty-session noise: only show once there is something to measure
  if (
    snapshot.context.used < 32 &&
    !snapshot.turns &&
    session.status === "ready" &&
    Object.keys(session.nodes).length === 0
  ) {
    return null;
  }

  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded border px-1.5 py-0.5",
          usageToneStyles(snapshot.peakTone).border,
          usageToneStyles(snapshot.peakTone).bg,
          usageToneStyles(snapshot.peakTone).glow,
          className
        )}
        role="meter"
        aria-label={`Context usage ${snapshot.context.percent} percent`}
        aria-valuenow={Math.min(100, snapshot.context.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        title={tooltipFor(snapshot.context, snapshot.turns)}
      >
        <Gauge
          className={cn(
            "h-3 w-3 shrink-0",
            usageToneStyles(snapshot.peakTone).text
          )}
        />
        {snapshot.meters.map((m) => (
          <MeterChip key={m.id} meter={m} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {snapshot.meters.map((m) => (
        <MeterRow key={m.id} meter={m} />
      ))}
    </div>
  );
}

function MeterChip({ meter }: { meter: UsageMeterModel }) {
  const styles = usageToneStyles(meter.tone);
  const fill = Math.min(100, Math.max(0, meter.percent));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "font-mono text-[9px] uppercase tracking-wider opacity-80",
          styles.text
        )}
      >
        {meter.shortLabel}
      </span>
      <span
        className="relative h-1.5 w-14 overflow-hidden rounded-full bg-black/50"
        aria-hidden
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out"
          style={{
            width: `${fill}%`,
            backgroundColor: styles.bar,
          }}
        />
        {meter.ratio >= 0.5 && (
          <span
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 3px, ${styles.bar} 3px, ${styles.bar} 4px)`,
              width: `${fill}%`,
            }}
          />
        )}
      </span>
      <span className={cn("font-mono text-[10px] tabular-nums", styles.text)}>
        {meter.id === "context"
          ? `${formatTokenCount(meter.used)}/${formatTokenCount(meter.limit)}`
          : `${meter.used}/${meter.limit}`}
        <span className="ml-0.5 opacity-70">{meter.percent}%</span>
      </span>
      {meter.estimated && meter.id === "context" && (
        <span className="font-mono text-[8px] uppercase tracking-wider text-phosphor-green/35">
          est
        </span>
      )}
    </span>
  );
}

function MeterRow({ meter }: { meter: UsageMeterModel }) {
  const styles = usageToneStyles(meter.tone);
  const fill = Math.min(100, Math.max(0, meter.percent));
  return (
    <div
      className={cn(
        "rounded border px-2 py-1.5",
        styles.border,
        styles.bg
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cn("font-mono text-[10px]", styles.text)}>
          {meter.label}
          <span className="ml-1.5 opacity-60">{styles.label}</span>
        </span>
        <span className={cn("font-mono text-[10px] tabular-nums", styles.text)}>
          {meter.id === "context"
            ? `${formatTokenCount(meter.used)} / ${formatTokenCount(meter.limit)}`
            : `${meter.used} / ${meter.limit}`}{" "}
          ({meter.percent}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/40">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300"
          style={{ width: `${fill}%`, backgroundColor: styles.bar }}
        />
      </div>
      <p className="mt-1 text-[9px] text-phosphor-green/40">{meter.detail}</p>
    </div>
  );
}

function tooltipFor(
  context: UsageMeterModel,
  turns: UsageMeterModel | null
): string {
  const lines = [
    `Context: ${formatTokenCount(context.used)} / ${formatTokenCount(context.limit)} (${context.percent}%) — ${usageToneStyles(context.tone).label}`,
    context.estimated ? "Token count is estimated from session content." : null,
    turns
      ? `Turns: ${turns.used} / ${turns.limit} (${turns.percent}%) — ${usageToneStyles(turns.tone).label}`
      : null,
    "Colors shift as usage approaches the limit.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Standalone helper for tests / overview panels. */
export function toneLabel(tone: UsageTone): string {
  return usageToneStyles(tone).label;
}
