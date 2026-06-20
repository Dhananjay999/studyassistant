import { useState } from "react";
import { Clock, HelpCircle, ListChecks, Loader2, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Seo } from "@/components/common/Seo";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useQuizzes } from "@/hooks/api";
import { getQuiz } from "@/lib/api";
import type { QuizContent } from "@/types";

export default function QuizzesPage() {
  const { data: quizzes = [], isLoading } = useQuizzes();
  const [quiz, setQuiz] = useState<QuizContent | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const start = async (id: string) => {
    setLoadingId(id);
    try {
      const q = await getQuiz(id);
      setQuiz(q);
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
          <div className="grid place-items-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : quizzes.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <ListChecks className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No quizzes yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Generate a quiz from any chat answer and it will show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quizzes.map((q) => (
              <GlassCard
                key={q.id}
                className="flex flex-col p-4 transition-shadow hover:shadow-glow"
              >
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
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {q.topic}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5" /> {q.question_count} Qs
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(q.created_at).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  onClick={() => start(q.quiz_id)}
                  disabled={loadingId === q.quiz_id}
                  className="mt-4 w-full gap-2 bg-brand-gradient text-white"
                >
                  {loadingId === q.quiz_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start Quiz
                </Button>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      <QuizDrawer quiz={quiz} open={open} onOpenChange={setOpen} />
    </AppShell>
  );
}
