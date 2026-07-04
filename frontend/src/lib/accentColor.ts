/**
 * Custom accent color helpers.
 *
 * The preset themes (`[data-theme="ocean"]`, …) override the accent CSS tokens
 * from a stylesheet. The "custom" theme has no stylesheet rule — instead we
 * write the same tokens as inline styles on `<html>` (inline wins over the
 * `[data-theme]` rules), derived from a single user-picked hex color.
 */

/** The accent CSS custom properties a theme controls (mirrors index.css). */
export const ACCENT_VARS = [
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--brand-1",
  "--brand-2",
  "--brand-3",
  "--brand-4",
] as const;

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse a `#rgb` / `#rrggbb` hex string into HSL (degrees / percent). */
export function hexToHsl(hex: string): Hsl {
  let clean = hex.replace(/^#/, "").trim();
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = Number.parseInt(clean, 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Format an HSL triplet the way the CSS tokens expect (`H S% L%`). */
function fmt({ h, s, l }: Hsl): string {
  return `${h} ${s}% ${l}%`;
}

const wrapHue = (h: number): number => ((h % 360) + 360) % 360;
const clampL = (l: number): number => Math.min(90, Math.max(28, l));

/**
 * Build the inline accent token map from a hex color.
 *
 * `--primary`/`--ring` use the chosen color (lightness nudged into a legible
 * band so text on it stays readable in both light and dark). The brand ramp
 * fans the hue out into an analogous gradient so `bg-brand-gradient` and the
 * aurora stay cohesive with the pick.
 */
export function accentVarsFromHex(hex: string): Record<string, string> {
  const base = hexToHsl(hex);
  const primary: Hsl = { h: base.h, s: base.s, l: clampL(base.l) };
  const ramp = (offset: number, dl: number): Hsl => ({
    h: wrapHue(base.h + offset),
    s: base.s,
    l: clampL(base.l + dl),
  });

  return {
    "--primary": fmt(primary),
    "--ring": fmt(primary),
    "--sidebar-primary": fmt(primary),
    "--sidebar-ring": fmt(primary),
    "--brand-1": fmt(ramp(0, 2)),
    "--brand-2": fmt(ramp(14, 0)),
    "--brand-3": fmt(ramp(28, 4)),
    "--brand-4": fmt(ramp(42, 2)),
  };
}
