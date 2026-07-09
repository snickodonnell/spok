"use client";

import {
  Brain,
  Wrench,
  CheckCircle2,
  GitBranch,
  Bot,
  FileCode2,
  AlertTriangle,
  MessageSquare,
  Target,
  ListTodo,
  Settings,
  Circle,
  type LucideIcon,
} from "lucide-react";
import type { TraceNodeType } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAP: Record<
  TraceNodeType,
  { icon: LucideIcon; color: string }
> = {
  session: { icon: Circle, color: "text-phosphor-green" },
  thinking: { icon: Brain, color: "text-phosphor-cyan" },
  reasoning: { icon: Brain, color: "text-phosphor-cyan" },
  tool_call: { icon: Wrench, color: "text-phosphor-amber" },
  tool_result: { icon: CheckCircle2, color: "text-phosphor-green" },
  plan: { icon: ListTodo, color: "text-phosphor-magenta" },
  plan_update: { icon: ListTodo, color: "text-phosphor-magenta" },
  subagent: { icon: Bot, color: "text-phosphor-cyan" },
  decision: { icon: GitBranch, color: "text-phosphor-amber" },
  message: { icon: MessageSquare, color: "text-phosphor-green/70" },
  error: { icon: AlertTriangle, color: "text-phosphor-red" },
  system: { icon: Settings, color: "text-white/40" },
  file_change: { icon: FileCode2, color: "text-phosphor-green" },
  goal: { icon: Target, color: "text-phosphor-amber" },
  branch: { icon: GitBranch, color: "text-phosphor-magenta" },
};

export function TraceNodeIcon({
  type,
  className,
  size = 14,
}: {
  type: TraceNodeType;
  className?: string;
  size?: number;
}) {
  const entry = MAP[type] ?? MAP.message;
  const Icon = entry.icon;
  return <Icon className={cn(entry.color, className)} size={size} />;
}

export function typeColor(type: TraceNodeType): string {
  return MAP[type]?.color ?? "text-phosphor-green/70";
}
