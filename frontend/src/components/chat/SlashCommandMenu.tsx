import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/lib/slashCommands";

/**
 * Floating command list shown above the composer. Filtering and keyboard
 * navigation are owned by the composer; this is purely presentational.
 */
export function SlashCommandMenu({
  commands,
  activeIndex,
  onSelect,
  onHover,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}) {
  if (!commands.length) return null;

  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
      <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Commands
      </p>
      {commands.map((c, i) => {
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            onMouseEnter={() => onHover(i)}
            // mousedown (not click) fires before the textarea blur.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm",
              i === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{c.label}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {c.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
