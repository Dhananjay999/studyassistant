// Study Space visual identity: app-level color/icon keys stored on the space
// row and rendered here. Keys are free to grow; unknown values fall back
// safely so old clients never break on new keys.

import {
  Atom,
  Book,
  BookOpen,
  Brain,
  Calculator,
  Code2,
  Dna,
  FlaskConical,
  Globe2,
  GraduationCap,
  Landmark,
  Languages,
  Microscope,
  Music2,
  Palette,
  Scale,
  Sparkles,
  Stethoscope,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { StudySpace } from "@/types";

/** Tailwind classes per palette key (literal strings so JIT keeps them). */
export const SPACE_COLORS: Record<
  string,
  { dot: string; text: string; tint: string; ring: string }
> = {
  brand: {
    dot: "bg-brand-1",
    text: "text-brand-1",
    tint: "bg-brand-1/10",
    ring: "border-brand-1/30",
  },
  violet: {
    dot: "bg-violet-500",
    text: "text-violet-500",
    tint: "bg-violet-500/10",
    ring: "border-violet-500/30",
  },
  blue: {
    dot: "bg-sky-500",
    text: "text-sky-500",
    tint: "bg-sky-500/10",
    ring: "border-sky-500/30",
  },
  emerald: {
    dot: "bg-emerald-500",
    text: "text-emerald-500",
    tint: "bg-emerald-500/10",
    ring: "border-emerald-500/30",
  },
  amber: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    tint: "bg-amber-500/10",
    ring: "border-amber-500/30",
  },
  rose: {
    dot: "bg-rose-500",
    text: "text-rose-500",
    tint: "bg-rose-500/10",
    ring: "border-rose-500/30",
  },
  cyan: {
    dot: "bg-cyan-500",
    text: "text-cyan-500",
    tint: "bg-cyan-500/10",
    ring: "border-cyan-500/30",
  },
};

export const SPACE_ICONS: Record<string, LucideIcon> = {
  book: Book,
  "book-open": BookOpen,
  atom: Atom,
  brain: Brain,
  calculator: Calculator,
  code: Code2,
  dna: Dna,
  flask: FlaskConical,
  globe: Globe2,
  "graduation-cap": GraduationCap,
  landmark: Landmark,
  languages: Languages,
  microscope: Microscope,
  music: Music2,
  palette: Palette,
  scale: Scale,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  "trending-up": TrendingUp,
};

export const SPACE_COLOR_KEYS = Object.keys(SPACE_COLORS);
export const SPACE_ICON_KEYS = Object.keys(SPACE_ICONS);

export function spaceColor(key: string | undefined) {
  return SPACE_COLORS[key ?? ""] ?? SPACE_COLORS.brand;
}

export function spaceIcon(key: string | undefined): LucideIcon {
  return SPACE_ICONS[key ?? ""] ?? Book;
}

/** Real (user-created) spaces — the invisible General space filtered out. */
export function realSpaces(spaces: StudySpace[] | undefined): StudySpace[] {
  return (spaces ?? []).filter((s) => !s.is_default);
}

/** The user's General space, when already loaded. */
export function defaultSpace(
  spaces: StudySpace[] | undefined,
): StudySpace | undefined {
  return (spaces ?? []).find((s) => s.is_default);
}
