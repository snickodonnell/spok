import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "border-phosphor-green/40 bg-phosphor-green/10 text-phosphor-green",
        cyan: "border-phosphor-cyan/40 bg-phosphor-cyan/10 text-phosphor-cyan",
        amber: "border-phosphor-amber/40 bg-phosphor-amber/10 text-phosphor-amber",
        magenta: "border-phosphor-magenta/40 bg-phosphor-magenta/10 text-phosphor-magenta",
        muted: "border-white/10 bg-white/5 text-white/50",
        error: "border-red-500/40 bg-red-500/10 text-red-400",
        success: "border-phosphor-green/40 bg-phosphor-green/15 text-phosphor-green",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
