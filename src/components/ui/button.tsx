import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--crt-bg)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-phosphor-green/15 text-phosphor-green border border-phosphor-green/40 hover:bg-phosphor-green/25 hover:shadow-[0_0_12px_rgba(51,255,102,0.25)]",
        secondary:
          "bg-phosphor-cyan/10 text-phosphor-cyan border border-phosphor-cyan/30 hover:bg-phosphor-cyan/20",
        amber:
          "bg-phosphor-amber/10 text-phosphor-amber border border-phosphor-amber/30 hover:bg-phosphor-amber/20",
        magenta:
          "bg-phosphor-magenta/10 text-phosphor-magenta border border-phosphor-magenta/30 hover:bg-phosphor-magenta/20",
        ghost:
          "text-phosphor-green/80 hover:bg-phosphor-green/10 hover:text-phosphor-green border border-transparent",
        destructive:
          "bg-red-500/15 text-red-400 border border-red-500/40 hover:bg-red-500/25",
        outline:
          "border border-phosphor-green/25 bg-transparent text-phosphor-green/90 hover:bg-phosphor-green/10",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
