import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useSubmitQuiz } from "@/hooks/api";
import { useSwipe } from "@/hooks/useSwipe";
import { cn } from "@/lib/utils";
import type { QuizContent, QuizSubmitResult } from "@/types";

/**
 * The quiz-taking experience: one question at a time, single/true-false answers
 * auto-advance, multi-select is manual. Submission is scored instantly by the
 * backend; the result is handed back via `onSubmitted`.
 */
export function QuizRunner({
  quiz,
  onSubmitted,
}: {
  quiz: QuizContent;
  onSubmitted: (result: QuizSubmitResult) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const startedAt = useRef(0);
  const submitMutation = useSubmitQuiz();

  const questions = quiz.questions ?? [];
  const total = questions.length;
  const q = questions[idx];
  const answered = Object.values(answers).filter((a) => a.length).length;

  // Touch: swipe left → next question, swipe right → previous. Mirrors the
  // arrow-key navigation and the on-screen Prev/Next buttons.
  const swipe = useSwipe({
    onSwipeLeft: () => setIdx((i) => Math.min(total - 1, i + 1)),
    onSwipeRight: () => setIdx((i) => Math.max(0, i - 1)),
  });

  // Start the timer when the runner mounts (i.e. a new attempt begins).
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Arrow-key navigation between questions.
  useEffect(() => {
    const last = total - 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx((i) => Math.min(last, i + 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  const setSingle = (qid: string, v: string) => {
    setAnswers((p) => ({ ...p, [qid]: [v] }));
    // Single-select & true/false auto-advance after a short beat.
    if (idx < total - 1) {
      window.setTimeout(() => setIdx((i) => Math.min(total - 1, i + 1)), 450);
    }
  };
  const toggleMulti = (qid: string, v: string) =>
    setAnswers((p) => {
      const cur = p[qid] || [];
      return {
        ...p,
        [qid]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
      };
    });

  const submit = async () => {
    if (!quiz.quiz_id) {
      toast.error("This quiz couldn't be identified. Please reopen it.");
      return;
    }
    const timeTakenSeconds = Math.max(
      1,
      Math.round((Date.now() - startedAt.current) / 1000),
    );
    try {
      const res = await submitMutation.mutateAsync({
        id: quiz.quiz_id,
        answers,
        timeTakenSeconds,
      });
      onSubmitted(res);
    } catch {
      toast.error("Couldn't submit the quiz. Please try again.");
    }
  };

  return (
    <>
      {total > 0 && (
        <div className="border-b border-border/50 px-5 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Question {idx + 1} of {total}
            </span>
            <span>{answered} answered</span>
          </div>
          <Progress value={((idx + 1) / total) * 100} className="mt-2 h-1" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-6" {...swipe}>
        {q ? (
          <div className="learning-content mx-auto max-w-2xl space-y-5">
            <p className="text-base font-medium leading-relaxed sm:text-lg">
              {q.prompt}
            </p>
            {q.type === "multi_select" ? (
              <div className="space-y-2">
                {q.options.map((opt) => (
                  <label
                    key={opt}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition-colors",
                      (answers[q.id] || []).includes(opt)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <Checkbox
                      checked={(answers[q.id] || []).includes(opt)}
                      onCheckedChange={() => toggleMulti(q.id, opt)}
                    />
                    {opt}
                  </label>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Select all that apply.
                </p>
              </div>
            ) : (
              <RadioGroup
                value={answers[q.id]?.[0] || ""}
                onValueChange={(v) => setSingle(q.id, v)}
                className="space-y-2"
              >
                {q.options.map((opt) => (
                  <Label
                    key={opt}
                    htmlFor={`${q.id}-${opt}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm font-normal transition-colors",
                      answers[q.id]?.[0] === opt
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <RadioGroupItem value={opt} id={`${q.id}-${opt}`} />
                    {opt}
                  </Label>
                ))}
              </RadioGroup>
            )}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border/50 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button
          variant="outline"
          size="sm"
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          {answered}/{total}
        </span>
        {idx < total - 1 ? (
          <Button
            size="sm"
            onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
            className="gap-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={submit}
            disabled={submitMutation.isPending}
            className="gap-1.5 bg-brand-gradient text-white"
          >
            {submitMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Submit quiz
          </Button>
        )}
      </footer>
    </>
  );
}
