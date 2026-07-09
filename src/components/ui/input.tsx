import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-phosphor-green/25 bg-black/50 px-3 py-1 text-sm text-phosphor-green shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-phosphor-green/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-phosphor-green/50 focus-visible:border-phosphor-green/50 disabled:cursor-not-allowed disabled:opacity-50 font-mono",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
