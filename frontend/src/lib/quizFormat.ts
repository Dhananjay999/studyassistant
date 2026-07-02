// Small formatting helpers shared across the quiz dashboard UI.

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
  const perQuestion =
    difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.6 : 0.9;
  return Math.max(1, Math.round(questionCount * perQuestion));
}

/** Display label + badge classes for a quiz difficulty. */
export function difficultyMeta(difficulty?: string | null): {
  label: string;
  className: string;
} {
  switch ((difficulty ?? "medium").toLowerCase()) {
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
    default:
      return {
        label: "Medium",
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
  }
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
