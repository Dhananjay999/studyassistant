import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wrap-around chip picker. Selection logic lives in the parent (single vs
 * multi), so this component just renders options and reports toggles — which
 * lets the onboarding wizard and the settings page share one control.
 */
export function ChipSelect({
  options,
  selected,
  onToggle,
  className,
}: {
  options: readonly string[];
  selected: readonly string[];
  onToggle: (option: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(option)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5",
              "text-sm font-medium transition-colors",
              active
                ? "border-brand-1 bg-brand-1/10 text-brand-1"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {active && <Check className="h-3.5 w-3.5" />}
            {option}
          </button>
        );
      })}
    </div>
  );
}
