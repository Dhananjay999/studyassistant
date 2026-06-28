import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  SegmentedControl,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/primitives";
import { usePreferences, type FontSize } from "@/contexts/PreferencesContext";

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const FONT_OPTIONS: ReadonlyArray<{ value: FontSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

/** Theme, font size, motion + density — with a live preview. */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize, reduceMotion, setReduceMotion, compact } =
    usePreferences();

  return (
    <div className="space-y-6">
      <SettingsGroup title="Theme">
        <div className="px-4 py-3">
          <SettingRow
            title="Color theme"
            description="Match your system, or lock to light or dark."
          >
            <SegmentedControl
              ariaLabel="Color theme"
              options={THEME_OPTIONS}
              value={(theme ?? "system") as (typeof THEME_OPTIONS)[number]["value"]}
              onChange={setTheme}
            />
          </SettingRow>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Display">
        <div className="divide-y divide-border/50 px-4">
          <SettingRow
            title="Font size"
            description="Scales the entire interface."
          >
            <SegmentedControl
              ariaLabel="Font size"
              options={FONT_OPTIONS}
              value={fontSize}
              onChange={setFontSize}
            />
          </SettingRow>
          <SettingRow
            title="Reduce motion"
            description="Minimize animations and transitions."
          >
            <Switch
              checked={reduceMotion}
              onCheckedChange={setReduceMotion}
              aria-label="Reduce motion"
            />
          </SettingRow>
          <SettingRow
            title="Compact mode"
            description="Tighter spacing for denser layouts."
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                Soon
              </Badge>
              <Switch checked={compact} disabled aria-label="Compact mode" />
            </div>
          </SettingRow>
        </div>
      </SettingsGroup>

      <AppearancePreview />
    </div>
  );
}

/** A small live sample that reflects the current theme/font/motion settings,
 *  since they all apply to <html>. */
function AppearancePreview() {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview
      </h2>
      <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <p className="font-display text-base font-bold">Aeva</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Photosynthesis converts light energy into chemical energy stored in
          glucose. Here's a quick breakdown you can follow step by step.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            Primary
          </span>
          <span className="inline-flex items-center rounded-full border border-brand-1 bg-brand-1/10 px-3 py-1 text-xs font-medium text-brand-1">
            Chip
          </span>
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Muted
          </span>
        </div>
      </div>
    </section>
  );
}
