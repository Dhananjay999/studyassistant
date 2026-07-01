import { useMemo, useState } from "react";
import {
  Clock,
  HelpCircle,
  History,
  ListChecks,
  Loader2,
  Play,
  Search,
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
import { relativeDay } from "@/lib/quizFormat";
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

  return (
    <GlassCard className="flex flex-col p-4 transition-shadow hover:shadow-glow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-display text-base font-bold">
          {q.title}
        </h3>
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
      {q.topic && (
        <p className="mt-1 truncate text-xs text-muted-foreground">{q.topic}</p>
      )}

      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <HelpCircle className="h-3.5 w-3.5" /> {q.question_count} Qs
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {new Date(q.created_at).toLocaleDateString()}
        </span>
        <span className="ml-auto font-medium">
          {attempted
            ? `Attempted ${q.attempt_count} time${q.attempt_count === 1 ? "" : "s"}`
            : "Not attempted"}
        </span>
      </div>

      {attempted ? (
        <div className="mt-3 rounded-xl border border-border/50 bg-card/40 p-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Best score
              </p>
              <p className="font-display text-lg font-bold tabular-nums">
                {q.best_correct ?? "—"}
                <span className="text-sm text-muted-foreground">
                  {" "}
                  / {q.question_count}
                </span>
              </p>
            </div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-brand-1">
              {pct}%
            </p>
          </div>
          <Progress value={pct} className="mt-2 h-1.5" />
          {q.last_attempt_at && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Last attempt {relativeDay(q.last_attempt_at)}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
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
          Open Quiz
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
