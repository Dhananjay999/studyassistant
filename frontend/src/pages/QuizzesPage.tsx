import { useMemo, useState } from "react";
import {
  BarChart3,
  Clock,
  Gauge,
  GraduationCap,
  HelpCircle,
  History,
  ListChecks,
  Loader2,
  Play,
  Repeat,
  Sparkles,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { ListToolbar } from "@/components/common/list";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import type { QuizInitialView } from "@/components/chat/QuizDrawer";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useExamPatterns, useQuizzes } from "@/hooks/api";
import { getQuiz } from "@/lib/api";
import { useListQuery } from "@/hooks/useListQuery";
import {
  applyListQuery,
  byDateAsc,
  byDateDesc,
  type ListConfig,
} from "@/lib/listQuery";
import {
  difficultyMeta,
  estimatedMinutes,
  formatTimeLimit,
  relativeDay,
} from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import {
  hasExamConfig,
  type ExamPattern,
  type QuizContent,
  type QuizListItem,
} from "@/types";

/** Sort/filter config for the quizzes list (exam patterns injected at runtime). */
function buildQuizConfig(patterns: ExamPattern[]): ListConfig<QuizListItem> {
  return {
    defaultSort: "recent",
    sorts: [
      { value: "recent", label: "Recently created", compare: (a, b) => byDateDesc(a.created_at, b.created_at) },
      { value: "oldest", label: "Oldest", compare: (a, b) => byDateAsc(a.created_at, b.created_at) },
      { value: "last_attempt", label: "Last attempt", compare: (a, b) => byDateDesc(a.last_attempt_at, b.last_attempt_at) },
      { value: "score_desc", label: "Highest score", compare: (a, b) => (b.best_score ?? -1) - (a.best_score ?? -1) },
      { value: "score_asc", label: "Lowest score", compare: (a, b) => (a.best_score ?? Infinity) - (b.best_score ?? Infinity) },
      { value: "most_attempted", label: "Most attempted", compare: (a, b) => b.attempt_count - a.attempt_count },
      { value: "az", label: "Alphabetical (A–Z)", compare: (a, b) => a.title.localeCompare(b.title) },
    ],
    filters: [
      {
        id: "status",
        label: "Status",
        kind: "multi",
        options: [
          { value: "attempted", label: "Attempted" },
          { value: "not_attempted", label: "Not attempted" },
        ],
        predicate: (q, sel) =>
          sel.some((s) =>
            s === "attempted" ? q.attempt_count > 0 : q.attempt_count === 0,
          ),
      },
      {
        id: "difficulty",
        label: "Difficulty",
        kind: "multi",
        options: [
          { value: "easy", label: "Easy" },
          { value: "medium", label: "Medium" },
          { value: "hard", label: "Hard" },
        ],
        predicate: (q, sel) => sel.includes((q.difficulty ?? "").toLowerCase()),
      },
      {
        id: "exam",
        label: "Exam pattern",
        kind: "multi",
        options: patterns.map((p) => ({ value: p.key, label: p.label })),
        predicate: (q, sel) =>
          hasExamConfig(q.exam_config) && sel.includes(q.exam_config.pattern),
      },
    ],
    searchFields: (q) => [q.title, q.topic],
  };
}

export default function QuizzesPage() {
  const { data: quizzes = [], isLoading } = useQuizzes();
  const { data: patterns = [] } = useExamPatterns();
  const [quiz, setQuiz] = useState<QuizContent | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<QuizInitialView>("take");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const config = useMemo(() => buildQuizConfig(patterns), [patterns]);
  const listQuery = useListQuery(config);
  const filtered = useMemo(
    () => applyListQuery(quizzes, config, listQuery.state),
    [quizzes, config, listQuery.state],
  );

  const openQuiz = async (id: string, initialView: QuizInitialView) => {
    setLoadingId(id);
    try {
      const q = await getQuiz(id);
      setQuiz(q);
      setView(initialView);
      setOpen(true);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <PageContainer title="Quizzes">
      <Seo title="Quizzes — Aeva" noindex path="/quizzes" />
      <div className="p-4">
        {isLoading ? (
          <CardGridSkeleton />
        ) : quizzes.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <ListChecks className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No quizzes yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Generate a quiz from any chat answer and it will show up here.
            </p>
          </div>
        ) : (
          <>
            <ListToolbar
              className="mb-4"
              config={config}
              query={listQuery}
              placeholder="Search quizzes by title or topic…"
            />
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No quizzes match your search or filters.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((q) => (
                  <QuizGridCard
                    key={q.id}
                    quiz={q}
                    loading={loadingId === q.quiz_id}
                    onOpen={(v) => openQuiz(q.quiz_id, v)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <QuizDrawer
        quiz={quiz}
        open={open}
        onOpenChange={setOpen}
        initialView={view}
      />
    </PageContainer>
  );
}

/** One compact metric cell used in the quiz card's stat row. */
function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof HelpCircle;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-muted/40 px-2 py-2 text-center">
      <Icon className="mb-1 h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-display text-sm font-bold leading-none tabular-nums">
        {value}
      </span>
      <span className="mt-1 text-[10px] leading-none text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function QuizGridCard({
  quiz: q,
  loading,
  onOpen,
}: {
  quiz: QuizListItem;
  loading: boolean;
  onOpen: (view: QuizInitialView) => void;
}) {
  const { data: patterns = [] } = useExamPatterns();
  const attempted = q.attempt_count > 0 && q.best_score !== null;
  const pct = Math.round(q.best_score ?? 0);
  const diff = difficultyMeta(q.difficulty);
  const minutes = estimatedMinutes(q.question_count, q.difficulty);
  const exam = hasExamConfig(q.exam_config) ? q.exam_config : null;
  const examLabel = exam
    ? (patterns.find((p) => p.key === exam.pattern)?.label ??
      (exam.pattern === "custom" ? "Exam" : exam.pattern))
    : null;

  return (
    <GlassCard className="flex h-full flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm">
      {/* Header: title + difficulty badge + bookmark */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-display text-base font-bold">
            {q.title}
          </h3>
          {q.topic && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {q.topic}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {examLabel && (
            <span className="flex items-center gap-0.5 rounded-full bg-brand-1/15 px-2 py-0.5 text-[10px] font-semibold text-brand-1">
              <GraduationCap className="h-3 w-3" />
              {examLabel}
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              diff.className,
            )}
          >
            {diff.label}
          </span>
          <BookmarkButton
            item={{
              item_type: "quiz",
              item_ref: q.quiz_id,
              title: q.title,
              content: q.topic || q.title,
              metadata: { quiz_id: q.quiz_id, topic: q.topic },
            }}
          />
        </div>
      </div>

      {/* Status badge — keeps both states the same vertical rhythm */}
      <div className="mt-3">
        {attempted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-1/10 px-2.5 py-1 text-[11px] font-medium text-brand-1">
            <Sparkles className="h-3 w-3" />
            Attempted {q.attempt_count}×
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Not Attempted
          </span>
        )}
      </div>

      {/* Metric row — differs by state but keeps identical layout/height */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {attempted ? (
          <>
            <Metric
              icon={BarChart3}
              label="Score"
              value={`${q.best_correct ?? 0}/${q.question_count}`}
            />
            <Metric icon={Gauge} label="Best" value={`${pct}%`} />
            <Metric
              icon={Repeat}
              label="Attempts"
              value={String(q.attempt_count)}
            />
          </>
        ) : (
          <>
            <Metric
              icon={HelpCircle}
              label="Questions"
              value={String(q.question_count)}
            />
            <Metric icon={Gauge} label="Level" value={diff.label} />
            <Metric
              icon={Clock}
              label={exam && exam.timer_seconds > 0 ? "Time limit" : "Est. time"}
              value={
                exam && exam.timer_seconds > 0
                  ? formatTimeLimit(exam.timer_seconds)
                  : `${minutes}m`
              }
            />
          </>
        )}
      </div>

      {/* Progress + last-attempt for attempted; est-time footnote otherwise.
         Both reserve one line so card heights stay aligned across the grid. */}
      {attempted ? (
        <div className="mt-3">
          <Progress value={pct} className="h-1.5" />
          <p className="mt-2 text-[10px] text-muted-foreground">
            {q.last_attempt_at
              ? `Last attempt ${relativeDay(q.last_attempt_at)}`
              : " "}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-muted/50" />
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />~{minutes} min · {q.question_count}{" "}
            questions
          </p>
        </div>
      )}

      {/* Actions pinned to the bottom so every card ends at the same line */}
      <div className="mt-auto flex gap-2 pt-4">
        <Button
          onClick={() => onOpen("take")}
          disabled={loading}
          variant="brand"
          className="flex-1 gap-2"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {attempted ? "Retake" : "Start Quiz"}
        </Button>
        <Button
          onClick={() => onOpen("attempts")}
          disabled={loading || !attempted}
          variant="outline"
          className="gap-2"
        >
          <History className="h-4 w-4" />
          Attempts
        </Button>
      </div>
    </GlassCard>
  );
}
