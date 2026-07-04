import { Check, Monitor, Moon, Pipette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SegmentedControl,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/primitives";
import {
  usePreferences,
  type ColorTheme,
  type ContentFont,
  type FontSize,
} from "@/contexts/PreferencesContext";
import { cn } from "@/lib/utils";

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

// Swatch colour is each theme's light-mode primary (matches index.css).
const ACCENTS: ReadonlyArray<{
  value: ColorTheme;
  label: string;
  color: string;
}> = [
  { value: "default", label: "Purple", color: "hsl(262 83% 58%)" },
  { value: "ocean", label: "Ocean", color: "hsl(208 90% 48%)" },
  { value: "emerald", label: "Emerald", color: "hsl(160 84% 36%)" },
  { value: "sunset", label: "Sunset", color: "hsl(22 90% 50%)" },
  { value: "gold", label: "Gold", color: "hsl(40 92% 40%)" },
  { value: "rose", label: "Rose", color: "hsl(340 80% 50%)" },
];

const CONTENT_FONTS: ReadonlyArray<{ value: ContentFont; label: string }> = [
  { value: "inter", label: "Inter (Default)" },
  { value: "poppins", label: "Poppins" },
  { value: "nunito", label: "Nunito" },
  { value: "source-sans", label: "Source Sans" },
  { value: "roboto", label: "Roboto" },
];

/** Theme, accent, learning typography, motion + density — with a live preview. */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const {
    colorTheme,
    setColorTheme,
    customAccent,
    setCustomAccent,
    fontSize,
    setFontSize,
    contentFont,
    setContentFont,
    reduceMotion,
    setReduceMotion,
    compact,
  } = usePreferences();

  return (
    <div className="space-y-6">
      <SettingsGroup title="Theme">
        <div className="divide-y divide-border/50 px-4">
          <SettingRow
            title="Mode"
            description="Match your system, or lock to light or dark."
          >
            <SegmentedControl
              ariaLabel="Color mode"
              options={THEME_OPTIONS}
              value={
                (theme ?? "system") as (typeof THEME_OPTIONS)[number]["value"]
              }
              onChange={setTheme}
            />
          </SettingRow>
          <div className="py-3">
            <p className="text-sm font-medium">Accent</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recolors buttons, chips, links, and progress across the app.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ACCENTS.map((accent) => {
                const active = colorTheme === accent.value;
                return (
                  <button
                    key={accent.value}
                    type="button"
                    onClick={() => setColorTheme(accent.value)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:bg-accent/40",
                    )}
                  >
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full"
                      style={{ background: accent.color }}
                    >
                      {active && (
                        <Check
                          className="h-4 w-4 text-white"
                          strokeWidth={3}
                        />
                      )}
                    </span>
                    <span className="text-[11px] font-medium">
                      {accent.label}
                    </span>
                  </button>
                );
              })}
              <CustomAccentSwatch
                active={colorTheme === "custom"}
                color={customAccent}
                onChange={setCustomAccent}
              />
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Learning content">
        <div className="divide-y divide-border/50 px-4">
          <SettingRow
            title="Text size"
            description="Affects AI answers, summaries, quizzes & flashcards — not menus."
          >
            <SegmentedControl
              ariaLabel="Learning text size"
              options={FONT_OPTIONS}
              value={fontSize}
              onChange={setFontSize}
            />
          </SettingRow>
          <SettingRow
            title="Font"
            description="The typeface for AI-generated learning content."
          >
            <Select
              value={contentFont}
              onValueChange={(v) => setContentFont(v as ContentFont)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Display">
        <div className="divide-y divide-border/50 px-4">
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

/**
 * Seventh swatch in the accent grid: opens a color picker in a popover. When
 * active it shows the chosen color; otherwise a rainbow hints "pick your own".
 * Picking applies live (the app + preview recolor instantly).
 */
function CustomAccentSwatch({
  active,
  color,
  onChange,
}: {
  active: boolean;
  color: string;
  onChange: (hex: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-pressed={active}
          className={cn(
            "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
            active
              ? "border-primary bg-primary/5"
              : "border-border/60 hover:bg-accent/40",
          )}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
            style={{
              background: active
                ? color
                : "conic-gradient(from 90deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
            }}
          >
            {active ? (
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            ) : (
              <Pipette className="h-3.5 w-3.5 text-white drop-shadow" />
            )}
          </span>
          <span className="text-[11px] font-medium">Custom</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-auto space-y-3 p-3 accent-picker"
      >
        <HexColorPicker color={color} onChange={onChange} />
        <div className="flex items-center gap-2">
          <span
            className="h-8 w-8 shrink-0 rounded-md border border-border/60"
            style={{ background: color }}
          />
          <HexColorInput
            color={color}
            onChange={onChange}
            prefixed
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Accent color hex value"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A live sample reflecting the current accent/typography settings. */
function AppearancePreview() {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview
      </h2>
      <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
        <p className="font-display text-base font-bold">Aeva</p>
        <p className="learning-content mt-1 text-sm text-muted-foreground">
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
