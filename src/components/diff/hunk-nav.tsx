"use client";

import type { FileDiff } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function HunkNav({
  file,
  onJump,
}: {
  file: FileDiff | null;
  onJump?: (hunkIndex: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  if (!file || file.hunks.length === 0) return null;

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(file.hunks.length - 1, next));
    setIdx(clamped);
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
        title="Previous hunk"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <span className={cn("min-w-[4.5rem] text-center font-mono text-[10px] text-phosphor-green/55")}>
        Hunk {idx + 1}/{file.hunks.length}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={idx >= file.hunks.length - 1}
        onClick={() => go(idx + 1)}
        title="Next hunk"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
