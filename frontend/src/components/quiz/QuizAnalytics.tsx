import { useMemo } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuizAttemptSummary } from "@/types";

/**
 * Improvement-over-time summary for a quiz: attempts, best/average, first vs
 * latest, the delta between them, and a small score sparkline.
 */
export function QuizAnalytics({
  attempts,
}: {
  attempts: QuizAttemptSummary[];
}) {
  // Attempts arrive newest-first; analytics want chronological order.
  const chrono = useMemo(
    () => [...attempts].sort((a, b) => a.attempt_number - b.attempt_number),
    [attempts],
  );

  if (chrono.length === 0) return null;

  const scores = chrono.map((a) => Math.round(a.score));
  const first = scores[0];
  const latest = scores[scores.length - 1];
  const best = Math.max(...scores);
  const average = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  const improvement = latest - first;

  const stats = [
    { label: "Attempts", value: `${chrono.length}` },
    { label: "Best", value: `${best}%` },
    { label: "Average", value: `${average}%` },
    { label: "First", value: `${first}%` },
    { label: "Latest", value: `${latest}%` },
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Your progress</p>
        {chrono.length > 1 && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-semibold tabular-nums",
              improvement > 0
                ? "text-emerald-500"
                : improvement < 0
                  ? "text-red-500"
                  : "text-muted-foreground",
            )}
          >
            {improvement >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {improvement >= 0 ? "+" : ""}
            {improvement}% improvement
          </span>
        )}
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

      {scores.length > 1 && <Sparkline scores={scores} />}
    </div>
  );
}

function Sparkline({ scores }: { scores: number[] }) {
  const W = 100;
  const H = 28;
  const n = scores.length;
  const pts = scores
    .map((s, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - (s / 100) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full text-brand-1"
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
