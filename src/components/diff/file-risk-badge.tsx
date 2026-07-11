"use client";

import { Badge } from "@/components/ui/badge";
import {
  fileRiskBadgeVariant,
  type FileRisk,
} from "@/lib/file-risk";
import { cn } from "@/lib/utils";

export function FileRiskBadge({
  risk,
  compact = false,
  className,
}: {
  risk: FileRisk;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant={fileRiskBadgeVariant(risk.level)}
      className={cn(
        "shrink-0 font-mono leading-none",
        compact ? "px-1 py-0 text-[8px]" : "text-[9px]",
        className
      )}
      title={`${risk.label}: ${risk.description}`}
    >
      {compact ? risk.shortLabel : risk.label}
    </Badge>
  );
}
