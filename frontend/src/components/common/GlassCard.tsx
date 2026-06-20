import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const GlassCard = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { strong?: boolean }
>(({ className, strong, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      strong ? "glass-strong" : "glass",
      "rounded-2xl",
      className,
    )}
    {...props}
  />
));
GlassCard.displayName = "GlassCard";
