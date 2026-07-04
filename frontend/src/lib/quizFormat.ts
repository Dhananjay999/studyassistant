// Small formatting helpers shared across the quiz dashboard UI.

import type { Difficulty, ExamConfig } from "@/types";

/** Difficulty bands, easiest → hardest, driven by a 1–10 slider. */
export const DIFFICULTY_ORDER: Difficulty[] = [
  "beginner",
  "easy",
  "medium",
  "hard",
  "expert",
];

/** Map a 1–10 slider level to a difficulty band (2 levels per band). */
export function levelToDifficulty(level: number): Difficulty {
  if (level <= 2) return "beginner";
  if (level <= 4) return "easy";
  if (level <= 6) return "medium";
  if (level <= 8) return "hard";
  return "expert";
}

/** Map a difficulty band back to a representative 1–10 slider level. */
export function difficultyToLevel(difficulty?: Difficulty | null): number {
  switch (difficulty) {
    case "beginner":
      return 1;
    case "easy":
      return 3;
    case "hard":
      return 7;
    case "expert":
      return 9;
    default:
      return 5;
  }
}

/** Neutral custom scheme: correct +1, no negative/skip marks, no timer. */
export const NEUTRAL_EXAM_CONFIG: ExamConfig = {
  pattern: "custom",
  correct: 1,
  negative: 0,
  skip: 0,
  timer_seconds: 0,
};

/** Whether a config is a "real" exam worth persisting (vs an ordinary quiz). */
export function isExamConfig(cfg: ExamConfig): boolean {
  return (
    cfg.pattern !== "custom" ||
    cfg.timer_seconds > 0 ||
    cfg.correct !== 1 ||
    cfg.negative !== 0 ||
    cfg.skip !== 0
  );
}

/** "1m 30s" / "45s" from a duration in seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/**
 * Rough time-to-complete estimate for a quiz, in whole minutes.
 * Assumes ~45s per question, scaled by difficulty. Always at least 1 minute.
 */
export function estimatedMinutes(
  questionCount: number,
  difficulty?: string | null,
): number {
  const perQuestion: Record<string, number> = {
    beginner: 0.5,
    easy: 0.6,
    medium: 0.9,
    hard: 1.3,
    expert: 1.6,
  };
  const rate = perQuestion[(difficulty ?? "medium").toLowerCase()] ?? 0.9;
  return Math.max(1, Math.round(questionCount * rate));
}

/** Display label + badge classes for a quiz difficulty. */
export function difficultyMeta(difficulty?: string | null): {
  label: string;
  className: string;
} {
  switch ((difficulty ?? "medium").toLowerCase()) {
    case "beginner":
      return {
        label: "Beginner",
        className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      };
    case "easy":
      return {
        label: "Easy",
        className:
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      };
    case "hard":
      return {
        label: "Hard",
        className: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      };
    case "expert":
      return {
        label: "Expert",
        className: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      };
    default:
      return {
        label: "Medium",
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
  }
}

/** A signed mark like "+4", "-1", "-0.66", or "0" (trims trailing zeros). */
export function formatMark(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
}

/** "12 / 40" style marks display; whole numbers stay whole. */
export function formatMarks(value: number, max?: number | null): string {
  const fmt = (n: number) => `${Math.round(n * 100) / 100}`;
  return max != null ? `${fmt(value)} / ${fmt(max)}` : fmt(value);
}

/** "1h 30m" / "45m" from a timer duration in seconds (rounded to minutes). */
export function formatTimeLimit(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** One-line marking scheme, e.g. "+4 / −1 / 0". */
export function markingSummary(cfg: ExamConfig): string {
  const neg = cfg.negative === 0 ? "0" : formatMark(cfg.negative);
  return `${formatMark(cfg.correct)} / ${neg} / ${cfg.skip}`;
}

/** Human relative day: "Today", "Yesterday", "3 days ago", or a date. */
export function relativeDay(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const DAY = 86_400_000;
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(then)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString();
}
