"use client";

import { Search, ChevronsDownUp, ChevronsUpDown, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSpokStore } from "@/lib/store";
import type { TraceNodeType } from "@/lib/types";

const TYPE_CHIPS: { type: TraceNodeType; label: string }[] = [
  { type: "thinking", label: "Think" },
  { type: "tool_call", label: "Tools" },
  { type: "file_change", label: "Files" },
  { type: "plan", label: "Plan" },
  { type: "subagent", label: "Agents" },
  { type: "error", label: "Errors" },
];

export function TraceToolbar() {
  const filter = useSpokStore((s) => s.traceFilter);
  const setTraceFilter = useSpokStore((s) => s.setTraceFilter);
  const expandAll = useSpokStore((s) => s.expandAll);
  const collapseAll = useSpokStore((s) => s.collapseAll);

  const toggleType = (type: TraceNodeType) => {
    const types = filter.types.includes(type)
      ? filter.types.filter((t) => t !== type)
      : [...filter.types, type];
    setTraceFilter({ types });
  };

  return (
    <div className="space-y-2 border-b border-phosphor-green/15 p-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-phosphor-green/40" />
          <Input
            value={filter.search}
            onChange={(e) => setTraceFilter({ search: e.target.value })}
            placeholder="Search traces…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={expandAll} title="Expand all">
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={collapseAll} title="Collapse all">
          <ChevronsDownUp className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Filter className="mr-1 h-3 w-3 text-phosphor-green/40" />
        {TYPE_CHIPS.map((c) => {
          const active = filter.types.includes(c.type);
          return (
            <button
              key={c.type}
              type="button"
              onClick={() => toggleType(c.type)}
              className={
                active
                  ? "rounded border border-phosphor-green/50 bg-phosphor-green/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-phosphor-green"
                  : "rounded border border-phosphor-green/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-phosphor-green/45 hover:border-phosphor-green/30"
              }
            >
              {c.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTraceFilter({ showOnlyLinked: !filter.showOnlyLinked })}
          className={
            filter.showOnlyLinked
              ? "rounded border border-phosphor-cyan/50 bg-phosphor-cyan/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-phosphor-cyan"
              : "rounded border border-phosphor-green/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-phosphor-green/45"
          }
        >
          Linked
        </button>
      </div>
    </div>
  );
}
