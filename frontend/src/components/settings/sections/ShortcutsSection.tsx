import { Fragment } from "react";
import { SettingsGroup } from "@/components/settings/primitives";
import { SHORTCUTS } from "@/components/settings/constants";
import { formatShortcut, isMac } from "@/lib/platform";

/** Read-only reference list of keyboard shortcuts. */
export function ShortcutsSection() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Speed up common actions. Modifier combos work anywhere in the app.
      </p>
      <SettingsGroup title="Shortcuts">
        <ul className="divide-y divide-border/50">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.label}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="text-sm">{shortcut.label}</span>
              <Keys keys={shortcut.keys} />
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </div>
  );
}

/** Render a shortcut as individual <kbd> chips (⌘ + F, or Ctrl + F). */
function Keys({ keys }: { keys: string[] }) {
  const mac = isMac();
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && !mac && (
            <span className="text-xs text-muted-foreground">+</span>
          )}
          <kbd className="inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {formatShortcut([key])}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
