"use client";

import type { FileDiff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function HunkNav({
  file,
  index: controlledIndex,
  onJump,
}: {
  file: FileDiff | null;
  /** Controlled hunk index (keyboard review flow). */
  index?: number;
  onJump?: (hunkIndex: number) => void;
}) {
  const [internalIdx, setInternalIdx] = useState(0);
  const controlled = controlledIndex != null;
  const idx = controlled ? controlledIndex : internalIdx;

  useEffect(() => {
    setInternalIdx(0);
  }, [file?.id]);

  if (!file || file.hunks.length === 0) return null;

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(file.hunks.length - 1, next));
    if (!controlled) setInternalIdx(clamped);
    onJump?.(clamped);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={idx <= 0}
        onClick={() => go(idx - 1)}
        title="Previous hunk (p)"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <span
        className={cn(
          "min-w-[4.5rem] text-center font-mono text-[10px] text-phosphor-green/55"
        )}
      >
        Hunk {idx + 1}/{file.hunks.length}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={idx >= file.hunks.length - 1}
        onClick={() => go(idx + 1)}
        title="Next hunk (n)"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
