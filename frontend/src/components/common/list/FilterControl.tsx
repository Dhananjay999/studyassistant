import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { DATE_PRESETS, type FilterGroup } from "@/lib/listQuery";
import { cn } from "@/lib/utils";

type Draft = Record<string, string[]>;

/**
 * "Filter (N)" trigger + an adaptive panel — a Popover on desktop, a bottom
 * Drawer on mobile. Edits happen against a local draft and commit on Apply;
 * "Clear all" empties the draft. `filters`/handlers come from `useListQuery`.
 */
export function FilterControl<T>({
  groups,
  filters,
  activeCount,
  onApply,
  onClearAll,
}: {
  groups: FilterGroup<T>[];
  filters: Draft;
  activeCount: number;
  onApply: (draft: Draft) => void;
  onClearAll: () => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(filters);

  // Reseed the draft from committed state whenever the panel opens.
  useEffect(() => {
    if (open) setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleValue = (group: FilterGroup<T>, value: string) =>
    setDraft((d) => {
      const cur = d[group.id] ?? [];
      const next =
        group.kind === "single"
          ? cur.includes(value)
            ? []
            : [value]
          : cur.includes(value)
            ? cur.filter((v) => v !== value)
            : [...cur, value];
      return { ...d, [group.id]: next };
    });

  const setGroup = (id: string, values: string[]) =>
    setDraft((d) => ({ ...d, [id]: values }));

  const apply = () => {
    onApply(draft);
    setOpen(false);
  };

  const clearAll = () => {
    setDraft({});
    onClearAll();
    setOpen(false);
  };

  const body = (
    <div className="space-y-5">
      {groups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          selected={draft[group.id] ?? []}
          onToggle={(v) => toggleValue(group, v)}
          onSetGroup={(v) => setGroup(group.id, v)}
        />
      ))}
    </div>
  );

  const trigger = (
    <Button variant="outline" className="gap-2">
      <SlidersHorizontal className="h-4 w-4" />
      Filter
      {activeCount > 0 && (
        <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 px-1.5">
          {activeCount}
        </Badge>
      )}
    </Button>
  );

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={clearAll}>
        Clear all
      </Button>
      <Button size="sm" onClick={apply}>
        Apply
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <div onClick={() => setOpen(true)}>{trigger}</div>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Filters</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-2">{body}</div>
          <DrawerFooter>{footer}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="max-h-[70vh] overflow-y-auto pr-1">{body}</div>
        <div className="mt-4 border-t border-border/60 pt-3">{footer}</div>
      </PopoverContent>
    </Popover>
  );
}

function GroupSection<T>({
  group,
  selected,
  onToggle,
  onSetGroup,
}: {
  group: FilterGroup<T>;
  selected: string[];
  onToggle: (value: string) => void;
  onSetGroup: (values: string[]) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.label}
      </p>
      {group.kind === "date" ? (
        <DateGroup selected={selected} onSetGroup={onSetGroup} />
      ) : (
        <div className="space-y-1">
          {group.options?.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-accent/50"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggle(opt.value)}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Preset chips + an optional custom range calendar for a date filter. */
function DateGroup({
  selected,
  onSetGroup,
}: {
  selected: string[];
  onSetGroup: (values: string[]) => void;
}) {
  const head = selected[0];
  const isCustom = head === "custom";
  const range: DateRange | undefined = isCustom
    ? {
        from: selected[1] ? new Date(selected[1]) : undefined,
        to: selected[2] ? new Date(selected[2]) : undefined,
      }
    : undefined;

  const iso = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onSetGroup(head === p.value ? [] : [p.value])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              head === p.value
                ? "border-brand-1 bg-brand-1/10 text-brand-1"
                : "border-border/60 hover:bg-accent/50",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSetGroup(isCustom ? [] : ["custom", "", ""])}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs",
            isCustom
              ? "border-brand-1 bg-brand-1/10 text-brand-1"
              : "border-border/60 hover:bg-accent/50",
          )}
        >
          Custom range
        </button>
      </div>
      {isCustom && (
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) =>
            onSetGroup(["custom", iso(r?.from), iso(r?.to)])
          }
          numberOfMonths={1}
          className="rounded-md border"
        />
      )}
    </div>
  );
}
