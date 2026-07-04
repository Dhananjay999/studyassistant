import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActiveChip } from "@/hooks/useListQuery";
import { cn } from "@/lib/utils";

/**
 * Removable chips for the currently-applied filters, plus a trailing
 * "Clear all". Renders nothing when there are no active filters. Date-range
 * chips carry an empty `value`, so they remove the whole group via
 * `onRemoveGroup`.
 */
export function ActiveFilterChips({
  chips,
  onRemove,
  onRemoveGroup,
  onClearAll,
  className,
}: {
  chips: ActiveChip[];
  onRemove: (groupId: string, value: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onClearAll: () => void;
  className?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={`${chip.groupId}:${chip.value}`}
          type="button"
          onClick={() =>
            chip.value
              ? onRemove(chip.groupId, chip.value)
              : onRemoveGroup(chip.groupId)
          }
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          {chip.label}
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={onClearAll}
      >
        Clear all
      </Button>
    </div>
  );
}
