import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  ChevronLeft,
  CircleDashed,
  Clock,
  Layers,
  ListChecks,
  Loader2,
  MinusCircle,
  Sparkles,
  Target,
  Trophy,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useAnalyzeQuiz, useCreateSession } from "@/hooks/api";
import { formatDuration } from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import type {
  ChatSeed,
  QuizAnalysis,
  QuizContent,
  QuizEvaluation,
} from "@/types";

/**
 * A permanent attempt "report card": score hero, summary tiles, collapsible
 * answer review, and the attempt's own AI analysis. Works for both a fresh
 * submission and a historical attempt loaded from the attempt history.
 */
export function QuizAttemptReport({
  quiz,
  evaluation: ev,
  attemptId,
  attemptNumber,
  initialAnalysis = null,
  onClose,
  onBack,
}: {
  quiz: QuizContent;
  evaluation: QuizEvaluation;
  attemptId: string;
  attemptNumber?: number;
  initialAnalysis?: QuizAnalysis | null;
  onClose: () => void;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  const createSession = useCreateSession();
  const analyzeMutation = useAnalyzeQuiz();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [analysis, setAnalysis] = useState<QuizAnalysis | null>(initialAnalysis);
  const [analysisOpen, setAnalysisOpen] = useState(false);

  const questions = quiz.questions ?? [];
  const hasMulti = questions.some((x) => x.type === "multi_select");

  const tiles = useMemo<
    Array<{ label: string; value: number; icon: typeof Target; tone: string }>
  >(() => {
    const base = [
      { label: "Total", value: ev.total, icon: ListChecks, tone: "muted" },
      {
        label: "Attempted",
        value: ev.attempted_count,
        icon: Target,
        tone: "muted",
      },
      {
        label: "Correct",
        value: ev.correct_count,
        icon: CheckCircle2,
        tone: "emerald",
      },
      {
        label: "Incorrect",
        value: ev.incorrect_count,
        icon: XCircle,
        tone: "red",
      },
    ];
    if (hasMulti) {
      base.push({
        label: "Partial",
        value: ev.partial_count,
        icon: MinusCircle,
        tone: "amber",
      });
    }
    base.push({
      label: "Unanswered",
      value: ev.unanswered_count,
      icon: CircleDashed,
      tone: "muted",
    });
    return base;
  }, [ev, hasMulti]);

  const runAnalysis = async () => {
    const res = await analyzeMutation.mutateAsync({
      id: quiz.quiz_id,
      attemptId,
    });
    setAnalysis(res);
    setAnalysisOpen(true);
  };

  const makeFlashcards = async () => {
    const focus = analysis?.revise_topics?.length
      ? `\n\nFocus areas: ${analysis.revise_topics.join(", ")}`
      : "";
    const content =
      `${quiz.title}\n\n` + questions.map((x) => x.prompt).join("\n") + focus;
    const seed: ChatSeed = { mode: "flashcards", content, title: quiz.title };
    const session = await createSession.mutateAsync({});
    onClose();
    navigate(`/chat?sessionId=${session.id}`, { state: { seed } });
  };

  return (
    <>
      <header className="border-b border-border/50 px-5 pr-12 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="-ml-2 h-7 w-7 shrink-0"
              aria-label="Back to attempts"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <h2 className="font-display text-lg font-bold">{quiz.title}</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {attemptNumber ? `Attempt #${attemptNumber} · ` : ""}Your results
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Score hero */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl bg-brand-gradient p-6 text-center text-white shadow-glow"
          >
            <Trophy className="mx-auto h-8 w-8" />
            <p className="mt-2 font-display text-5xl font-extrabold tabular-nums">
              {Math.round(ev.score)}%
            </p>
            <p className="mt-1 text-sm opacity-90">
              {ev.correct_count}/{ev.total} correct
              {ev.time_taken_seconds
                ? ` · ${formatDuration(ev.time_taken_seconds)}`
                : ""}
            </p>
          </motion.div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {tiles.map((t) => (
              <StatTile
                key={t.label}
                label={t.label}
                value={t.value}
                icon={t.icon}
                tone={t.tone}
              />
            ))}
            <StatTile
              label="Accuracy"
              value={`${Math.round(ev.score)}%`}
              icon={Target}
              tone="violet"
            />
            <StatTile
              label="Time"
              value={formatDuration(ev.time_taken_seconds ?? 0)}
              icon={Clock}
              tone="muted"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setReviewOpen((o) => !o)}
              className="flex-1 gap-1.5"
            >
              <ListChecks className="h-4 w-4" />
              {reviewOpen ? "Hide review" : "Review answers"}
            </Button>
            {analysis ? (
              <Button
                variant="outline"
                onClick={() => setAnalysisOpen((o) => !o)}
                className="flex-1 gap-1.5"
              >
                <Sparkles className="h-4 w-4 text-brand-1" />
                {analysisOpen ? "Hide AI analysis" : "View AI analysis"}
              </Button>
            ) : (
              <Button
                onClick={runAnalysis}
                disabled={analyzeMutation.isPending}
                className="flex-1 gap-1.5 bg-brand-gradient text-white"
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4" />
                )}
                {analyzeMutation.isPending
                  ? "Analyzing…"
                  : "Analyze my performance"}
              </Button>
            )}
          </div>

          {analyzeMutation.isError && !analysis && (
            <p className="text-center text-xs text-destructive">
              Couldn't analyze right now. Please try again.
            </p>
          )}

          {/* AI analysis */}
          {analysis && analysisOpen && <AnalysisPanel analysis={analysis} />}

          {/* Review */}
          {reviewOpen && <ReviewPanel quiz={quiz} evaluation={ev} />}

          {/* Keep learning */}
          <div className="space-y-2 border-t border-border/50 pt-4">
            <p className="text-sm font-semibold">Keep learning</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={makeFlashcards}
                disabled={createSession.isPending}
                className="flex-1 gap-1.5 bg-brand-gradient text-white"
              >
                <Layers className="h-4 w-4" /> Create flashcards
              </Button>
              <BookmarkButton
                label
                item={{
                  item_type: "quiz",
                  item_ref: quiz.quiz_id,
                  title: quiz.title,
                  content: quiz.topic || quiz.title,
                  metadata: {
                    quiz_id: quiz.quiz_id,
                    score: ev.score,
                  },
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const TONES: Record<string, string> = {
  muted: "text-muted-foreground",
  emerald: "text-emerald-500",
  red: "text-red-500",
  amber: "text-amber-500",
  violet: "text-brand-1",
};

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: typeof Target;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", TONES[tone])} />
        {label}
      </div>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function AnalysisPanel({ analysis }: { analysis: QuizAnalysis }) {
  const sections: Array<{ title: string; items: string[]; accent: string }> = [
    {
      title: "Strengths",
      items: analysis.strengths,
      accent: "text-emerald-500",
    },
    { title: "Weaknesses", items: analysis.weaknesses, accent: "text-red-500" },
    {
      title: "Common mistakes",
      items: analysis.common_mistakes,
      accent: "text-amber-500",
    },
    {
      title: "Topics to revise",
      items: analysis.revise_topics,
      accent: "text-brand-1",
    },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 rounded-2xl border border-brand-1/20 bg-brand-1/5 p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-1" />
        <p className="text-sm font-semibold">AI performance analysis</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections
          .filter((s) => s.items?.length)
          .map((s) => (
            <div key={s.title}>
              <p className={cn("mb-1 text-xs font-semibold", s.accent)}>
                {s.title}
              </p>
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {s.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
      {analysis.study_plan?.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Your study plan</p>
          <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
            {analysis.study_plan.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ol>
        </div>
      )}
    </motion.div>
  );
}

function ReviewPanel({
  quiz,
  evaluation,
}: {
  quiz: QuizContent;
  evaluation: QuizEvaluation;
}) {
  const questions = quiz.questions ?? [];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
    >
      <p className="text-sm font-semibold">Answer review</p>
      {evaluation.per_question.map((row, i) => {
        const q = questions.find((x) => x.id === row.question_id);
        const tone = row.is_correct
          ? "border-emerald-500/30 bg-emerald-500/5"
          : row.partial
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-red-500/30 bg-red-500/5";
        return (
          <div
            key={row.question_id}
            className={cn("rounded-xl border p-3 text-sm", tone)}
          >
            <div className="flex items-start gap-2">
              {row.is_correct ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : row.partial ? (
                <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              )}
              <div className="min-w-0">
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
                {row.explanation && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.explanation}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}
