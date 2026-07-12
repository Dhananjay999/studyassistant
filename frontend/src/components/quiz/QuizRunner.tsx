import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useSubmitQuiz } from "@/hooks/api";
import { useSwipe } from "@/hooks/useSwipe";
import { markingSummary } from "@/lib/quizFormat";
import { MathText } from "@/components/common/MathText";
import { cn } from "@/lib/utils";
import { hasExamConfig, type QuizContent, type QuizSubmitResult } from "@/types";

/** "12:05" clock from a whole number of seconds. */
function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** How long the answer stays locked on screen before auto-advancing. */
const AUTO_NEXT_MS = 3000;

/**
 * The quiz-taking experience: one question at a time, single/true-false answers
 * auto-advance, multi-select is manual. Submission is scored instantly by the
 * backend; the result is handed back via `onSubmitted`.
 */
export function QuizRunner({
  quiz,
  onSubmitted,
  onSubmit,
}: {
  quiz: QuizContent;
  onSubmitted: (result: QuizSubmitResult) => void;
  /** Override the (authed) submit — e.g. a public guest submit on a share
   * page. Receives the answers + elapsed seconds, returns the scored result. */
  onSubmit?: (
    answers: Record<string, string[]>,
    timeTakenSeconds: number,
  ) => Promise<QuizSubmitResult>;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(0);
  const submitMutation = useSubmitQuiz();

  const questions = useMemo(() => quiz.questions ?? [], [quiz.questions]);
  const total = questions.length;
  const q = questions[idx];
  const answered = Object.values(answers).filter((a) => a.length).length;

  // Exam Mode: countdown timer + a live exam info panel. Absent for ordinary
  // practice quizzes, which render exactly as before.
  const exam = hasExamConfig(quiz.exam_config) ? quiz.exam_config : null;
  const timerSeconds = exam?.timer_seconds ?? 0;
  const hasTimer = timerSeconds > 0;
  const [remaining, setRemaining] = useState(timerSeconds);
  const [expired, setExpired] = useState(false);
  const deadlineRef = useRef(0);
  const submittedRef = useRef(false);

  // Track visited questions so "skipped" (visited but left unanswered) is a
  // meaningful live stat distinct from "remaining" (not yet reached).
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }, [idx]);

  const skipped = useMemo(
    () =>
      [...visited].filter(
        (i) => i !== idx && !(answers[questions[i]?.id]?.length),
      ).length,
    [visited, idx, answers, questions],
  );

  // Low-time warning under 10% of the limit (capped at 60s).
  const warnThreshold = Math.min(60, Math.round(timerSeconds * 0.1));
  const lowTime = hasTimer && remaining <= warnThreshold;

  // Touch: swipe left → next question, swipe right → previous. Mirrors the
  // arrow-key navigation and the on-screen Prev/Next buttons.
  const swipe = useSwipe({
    onSwipeLeft: () => setIdx((i) => Math.min(total - 1, i + 1)),
    onSwipeRight: () => setIdx((i) => Math.max(0, i - 1)),
  });

  // Start the timer when the runner mounts (i.e. a new attempt begins).
  useEffect(() => {
    startedAt.current = Date.now();
    deadlineRef.current = startedAt.current + timerSeconds * 1000;
  }, [timerSeconds]);

  // Countdown: tick once a second and auto-submit when it hits zero.
  useEffect(() => {
    if (!hasTimer) return;
    const tick = () => {
      const rem = Math.max(
        0,
        Math.round((deadlineRef.current - Date.now()) / 1000),
      );
      setRemaining(rem);
      if (rem <= 0) setExpired(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [hasTimer]);

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

  // Auto-next: after a single-select/true-false answer, the choice locks and a
  // visible countdown runs before the next question, so the transition never
  // feels abrupt. Navigating away (Next/Prev/swipe/keys) cancels it.
  const [lockedQ, setLockedQ] = useState<string | null>(null);
  const autoNextTimer = useRef<number | null>(null);

  // Any question change (auto or manual) unlocks and cancels a pending
  // advance; the cleanup also covers unmount mid-countdown.
  useEffect(() => {
    setLockedQ(null);
    return () => {
      if (autoNextTimer.current !== null) {
        window.clearTimeout(autoNextTimer.current);
        autoNextTimer.current = null;
      }
    };
  }, [idx]);

  const setSingle = (qid: string, v: string) => {
    // The answer is locked during the countdown — no accidental re-picks.
    if (lockedQ === qid) return;
    setAnswers((p) => ({ ...p, [qid]: [v] }));
    if (idx < total - 1) {
      setLockedQ(qid);
      autoNextTimer.current = window.setTimeout(() => {
        autoNextTimer.current = null;
        setIdx((i) => Math.min(total - 1, i + 1));
      }, AUTO_NEXT_MS);
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

  const submit = async (auto = false) => {
    // Guard against a double submit (e.g. manual click racing the timer).
    if (submittedRef.current) return;
    if (!quiz.quiz_id) {
      toast.error("This quiz couldn't be identified. Please reopen it.");
      return;
    }
    submittedRef.current = true;
    setSubmitting(true);
    const timeTakenSeconds = Math.max(
      1,
      Math.round((Date.now() - startedAt.current) / 1000),
    );
    try {
      const res = onSubmit
        ? await onSubmit(answers, timeTakenSeconds)
        : await submitMutation.mutateAsync({
            id: quiz.quiz_id,
            answers,
            timeTakenSeconds,
          });
      if (auto) toast.info("Time's up — your exam was submitted.");
      onSubmitted(res);
    } catch {
      submittedRef.current = false;
      setSubmitting(false);
      toast.error("Couldn't submit the quiz. Please try again.");
    }
  };

  // Auto-submit once the countdown expires (reads the latest answers).
  useEffect(() => {
    if (expired) void submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  return (
    <>
      {total > 0 && (
        <div className="border-b border-border/50 px-5 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Question {idx + 1} of {total}
            </span>
            {hasTimer ? (
              <span
                className={cn(
                  "flex items-center gap-1 font-mono font-semibold tabular-nums",
                  lowTime
                    ? "animate-pulse text-rose-600 dark:text-rose-400"
                    : "text-foreground",
                )}
              >
                <Clock className="h-3.5 w-3.5" />
                {clock(remaining)}
              </span>
            ) : (
              <span>{answered} answered</span>
            )}
          </div>
          <Progress value={((idx + 1) / total) * 100} className="mt-2 h-1" />
          {exam && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                Attempted{" "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {answered}
                </span>
              </span>
              <span>
                Remaining{" "}
                <span className="font-semibold text-foreground">
                  {total - answered}
                </span>
              </span>
              <span>
                Skipped{" "}
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {skipped}
                </span>
              </span>
              <span className="ml-auto">
                Marking{" "}
                <span className="font-mono font-semibold text-foreground">
                  {markingSummary(exam)}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-6" {...swipe}>
        {q ? (
          <div className="learning-content mx-auto max-w-2xl space-y-5">
            <p className="text-base font-medium leading-relaxed sm:text-lg">
              <MathText>{q.prompt}</MathText>
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
                    <MathText>{opt}</MathText>
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
                disabled={lockedQ === q.id}
                className="space-y-2"
              >
                {q.options.map((opt) => {
                  const selected = answers[q.id]?.[0] === opt;
                  const locked = lockedQ === q.id;
                  return (
                    <Label
                      key={opt}
                      htmlFor={`${q.id}-${opt}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm font-normal transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50",
                        locked && !selected && "opacity-50",
                        locked && "cursor-default",
                      )}
                    >
                      <RadioGroupItem value={opt} id={`${q.id}-${opt}`} />
                      <MathText>{opt}</MathText>
                      {locked && selected && (
                        <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />
                      )}
                    </Label>
                  );
                })}
              </RadioGroup>
            )}

            {/* Auto-next countdown: the answer is locked and a progress bar
               shows exactly when the next question arrives. */}
            {lockedQ === q.id && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5"
              >
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-primary">
                    <Lock className="h-3.5 w-3.5" /> Answer locked
                  </span>
                  <span className="text-muted-foreground">
                    Next question…
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{
                      duration: AUTO_NEXT_MS / 1000,
                      ease: "linear",
                    }}
                    className="h-full rounded-full bg-primary"
                  />
                </div>
              </motion.div>
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
            onClick={() => submit()}
            disabled={submitting}
            className="gap-1.5 bg-brand-gradient text-white"
          >
            {submitting ? (
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
