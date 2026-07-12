// Small icon/value/label tile used across share renderers.

import type { HelpCircle } from "lucide-react";

export function ShareMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof HelpCircle;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-muted/40 px-2 py-2 text-center">
      <Icon className="mb-1 h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-display text-sm font-bold leading-none tabular-nums">
        {value}
      </span>
      <span className="mt-1 text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
