import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trophy,
  XCircle,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSubmitQuiz } from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { QuizContent, QuizEvaluation, QuizFeedback } from "@/types";

export function QuizDrawer({
  quiz,
  open,
  onOpenChange,
}: {
  quiz: QuizContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{
    evaluation: QuizEvaluation;
    feedback: QuizFeedback;
  } | null>(null);
  const submitMutation = useSubmitQuiz();

  // Reset whenever a different quiz is opened.
  useEffect(() => {
    setIdx(0);
    setAnswers({});
    setResult(null);
  }, [quiz?.quiz_id]);

  if (!quiz) return null;
  const questions = quiz.questions ?? [];
  const total = questions.length;
  const q = questions[idx];
  const answered = Object.values(answers).filter((a) => a.length).length;

  const setSingle = (qid: string, v: string) =>
    setAnswers((p) => ({ ...p, [qid]: [v] }));
  const toggleMulti = (qid: string, v: string) =>
    setAnswers((p) => {
      const cur = p[qid] || [];
      return {
        ...p,
        [qid]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
      };
    });

  const submit = async () => {
    const res = await submitMutation.mutateAsync({
      id: quiz.quiz_id,
      answers,
    });
    setResult({ evaluation: res.evaluation, feedback: res.feedback });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <div className="border-b border-border/50 px-5 py-4">
          <h2 className="font-display text-lg font-bold">{quiz.title}</h2>
          {!result && total > 0 && (
            <>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Question {idx + 1} of {total}
                </span>
                <span>{answered} answered</span>
              </div>
              <Progress
                value={((idx + 1) / total) * 100}
                className="mt-2 h-1"
              />
            </>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="px-5 py-5">
            {result ? (
              <QuizResults quiz={quiz} result={result} />
            ) : q ? (
              <div className="space-y-4">
                <p className="text-base font-medium leading-relaxed">
                  {q.prompt}
                </p>
                {q.type === "multi_select" ? (
                  <div className="space-y-2">
                    {q.options.map((opt) => (
                      <label
                        key={opt}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors",
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
                          "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-normal transition-colors",
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
        </ScrollArea>

        {!result && (
          <div className="flex items-center justify-between gap-2 border-t border-border/50 px-5 py-4">
            <Button
              variant="outline"
              size="sm"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
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
              >
                {submitMutation.isPending ? "Submitting…" : "Submit quiz"}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function QuizResults({
  quiz,
  result,
}: {
  quiz: QuizContent;
  result: { evaluation: QuizEvaluation; feedback: QuizFeedback };
}) {
  const questions = quiz.questions ?? [];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-brand-gradient p-5 text-center text-white shadow-glow">
        <Trophy className="mx-auto h-7 w-7" />
        <p className="mt-2 font-display text-3xl font-extrabold">
          {result.evaluation.score}%
        </p>
        <p className="text-sm opacity-90">
          {result.evaluation.correct_count}/{result.evaluation.total} correct
        </p>
      </div>

      <div className="space-y-2">
        {result.evaluation.per_question.map((row, i) => {
          const q = questions.find((x) => x.id === row.question_id);
          return (
            <div
              key={row.question_id}
              className={cn(
                "rounded-xl border p-3 text-sm",
                row.is_correct
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-red-500/30 bg-red-500/5",
              )}
            >
              <div className="flex items-start gap-2">
                {row.is_correct ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div>
                  <p className="font-medium">
                    {i + 1}. {q?.prompt ?? row.question_id}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your answer: {row.user_answer.join(", ") || "—"}
                  </p>
                  {!row.is_correct && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Correct: {row.correct_answer.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 rounded-xl border border-border/50 p-4 text-sm">
        <p className="font-semibold">Feedback</p>
        <p className="text-muted-foreground">{result.feedback.summary}</p>
        {result.feedback.weak_topics.length > 0 && (
          <p className="text-xs">
            <span className="font-medium">Focus on: </span>
            {result.feedback.weak_topics.join(", ")}
          </p>
        )}
        {result.feedback.recommendations.length > 0 && (
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {result.feedback.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
