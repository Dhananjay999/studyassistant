import { cn } from "@/lib/utils";
import type { FlashcardAnalytics as Analytics } from "@/types";

/**
 * KPI panel for a flashcard set's study progress. Mirrors the quiz
 * "Your progress" analytics: a grid of stat-tiles plus a completion bar. All
 * values come straight from the server-computed analytics (studied / mastered /
 * needs_revision / completion), so it stays correct as the user rates cards.
 */
export function FlashcardAnalytics({
  analytics,
  className,
}: {
  analytics: Analytics;
  className?: string;
}) {
  const remaining = Math.max(0, analytics.total - analytics.studied);
  const stats = [
    { label: "Total", value: analytics.total },
    { label: "Reviewed", value: analytics.studied },
    { label: "Mastered", value: analytics.mastered },
    { label: "To revise", value: analytics.needs_revision },
    { label: "Remaining", value: remaining },
  ];

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/40 p-4 text-left",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Your progress</p>
        <span className="text-xs font-semibold tabular-nums text-brand-1">
          {analytics.completion}% complete
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-muted/40 p-2 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </p>
            <p className="font-display text-lg font-bold tabular-nums">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand-gradient transition-all"
          style={{ width: `${Math.min(100, analytics.completion)}%` }}
        />
      </div>
    </div>
  );
}
