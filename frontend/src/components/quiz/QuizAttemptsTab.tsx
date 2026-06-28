import { ChevronRight, History, Loader2, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuizAttempts } from "@/hooks/api";
import { relativeDay } from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import { QuizAnalytics } from "@/components/quiz/QuizAnalytics";

/**
 * The "Attempts" tab: improvement analytics on top, then the full attempt
 * history (newest first). Each row opens that attempt's report card.
 */
export function QuizAttemptsTab({
  quizId,
  onOpenAttempt,
  onStartAttempt,
}: {
  quizId: string;
  onOpenAttempt: (attemptId: string) => void;
  onStartAttempt: () => void;
}) {
  const { data: attempts = [], isLoading } = useQuizAttempts(quizId);

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-16 text-center">
        <History className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-medium">No attempts yet</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Take the quiz and your attempts will be saved here so you can track
          your progress over time.
        </p>
        <Button
          onClick={onStartAttempt}
          className="mt-4 gap-1.5 bg-brand-gradient text-white"
        >
          Start your first attempt
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <QuizAnalytics attempts={attempts} />

      <div className="space-y-2">
        {attempts.map((a) => {
          const pct = Math.round(a.score);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenAttempt(a.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card/50 p-3 text-left transition-colors hover:border-brand-1/40 hover:bg-muted/50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-display text-sm font-bold tabular-nums">
                #{a.attempt_number}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-bold tabular-nums">
                    {pct}%
                  </span>
                  {a.is_best && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3 fill-current" /> Best score
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{relativeDay(a.created_at)}</span>
                  <span>·</span>
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      a.has_analysis && "text-brand-1",
                    )}
                  >
                    {a.has_analysis ? (
                      <>
                        <Sparkles className="h-3 w-3" /> View AI analysis
                      </>
                    ) : (
                      "Not analyzed yet"
                    )}
                  </span>
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
