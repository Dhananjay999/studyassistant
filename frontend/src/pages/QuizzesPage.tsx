import { useMemo, useState } from "react";
import {
  BarChart3,
  Clock,
  Gauge,
  HelpCircle,
  History,
  ListChecks,
  Loader2,
  Play,
  Repeat,
  Search,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import type { QuizInitialView } from "@/components/chat/QuizDrawer";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useQuizzes } from "@/hooks/api";
import { getQuiz } from "@/lib/api";
import {
  difficultyMeta,
  estimatedMinutes,
  relativeDay,
} from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import type { QuizContent, QuizListItem } from "@/types";

export default function QuizzesPage() {
  const { data: quizzes = [], isLoading } = useQuizzes();
  const [quiz, setQuiz] = useState<QuizContent | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<QuizInitialView>("take");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Instant client-side filter by title or topic.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quizzes;
    return quizzes.filter(
      (x) =>
        x.title.toLowerCase().includes(q) ||
        (x.topic ?? "").toLowerCase().includes(q),
    );
  }, [quizzes, query]);

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
    <AppShell title="Quizzes">
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
            <div className="relative mb-4 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search quizzes by title or topic…"
                className="pl-9"
                aria-label="Search quizzes"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No quizzes match “{query}”.
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
    </AppShell>
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
  const attempted = q.attempt_count > 0 && q.best_score !== null;
  const pct = Math.round(q.best_score ?? 0);
  const diff = difficultyMeta(q.difficulty);
  const minutes = estimatedMinutes(q.question_count, q.difficulty);

  return (
    <GlassCard className="flex h-full flex-col p-4 transition-shadow hover:shadow-glow">
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
            <Metric icon={Clock} label="Est. time" value={`${minutes}m`} />
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
          className="flex-1 gap-2 bg-brand-gradient text-white"
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
