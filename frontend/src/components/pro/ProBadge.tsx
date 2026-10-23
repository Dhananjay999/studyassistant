// Small "PRO" marker for advanced features. Purely informative during Early
// Access: the feature it sits next to stays fully usable for everyone.

import { cn } from "@/lib/utils";

export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      aria-label="Pro feature"
      data-analytics-ignore
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-brand-gradient px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide text-white",
        className,
      )}
    >
      Pro
    </span>
  );
}
