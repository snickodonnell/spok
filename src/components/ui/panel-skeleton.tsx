"use client";

import { cn } from "@/lib/utils";

/**
 * Stable placeholder for panel content so tab switches / loading
 * do not shift layout (Horizon 1 jank reduction).
 */
export function PanelSkeleton({
  rows = 6,
  className,
  label = "Loading…",
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[12rem] flex-col gap-2 p-3",
        className
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="panel-skeleton"
    >
      <div className="h-3 w-24 animate-pulse rounded bg-phosphor-green/10" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded bg-phosphor-green/8"
          style={{ width: `${70 + ((i * 13) % 30)}%` }}
        />
      ))}
    </div>
  );
}
