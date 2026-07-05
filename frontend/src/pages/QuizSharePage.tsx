import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, Gauge, HelpCircle, ListChecks, Loader2, Play } from "lucide-react";
import { AppLoader } from "@/components/common/AppLoader";
import { BrandLogo } from "@/components/common/BrandLogo";
import { GlassCard } from "@/components/common/GlassCard";
import { Seo } from "@/components/common/Seo";
import { Button } from "@/components/ui/button";
import { QuizRunner } from "@/components/quiz/QuizRunner";
import { QuizAttemptReport } from "@/components/quiz/QuizAttemptReport";
import { getSharedQuiz, submitSharedQuiz } from "@/lib/api";
import { difficultyMeta, estimatedMinutes } from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import type { QuizSubmitResult } from "@/types";

type View = "landing" | "run" | "report";

/**
 * Public, no-login quiz attempt reached from a share link. The backend share
 * URL renders social OG tags and redirects a human here; this page fetches the
 * quiz (without answers), runs it, and scores it via the public guest endpoints.
 */
export default function QuizSharePage() {
  const { shareId = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("landing");
  const [result, setResult] = useState<QuizSubmitResult | null>(null);

  const {
    data: quiz,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["sharedQuiz", shareId],
    queryFn: () => getSharedQuiz(shareId),
    enabled: Boolean(shareId),
    retry: false,
  });

  const handleSubmit = async (
    answers: Record<string, string[]>,
    timeTakenSeconds: number,
  ): Promise<QuizSubmitResult> => {
    const { evaluation } = await submitSharedQuiz(
      shareId,
      answers,
      timeTakenSeconds,
    );
    return { attempt_id: "", evaluation };
  };

  if (isLoading) return <AppLoader />;

  if (isError || !quiz) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <BrandLogo className="mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold">Quiz not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This share link is invalid or was removed.
          </p>
          <Button className="mt-5" onClick={() => navigate("/")}>
            Go to StudyAssistant
          </Button>
        </div>
      </div>
    );
  }

  const count = quiz.questions?.length ?? 0;
  const diff = difficultyMeta(quiz.difficulty ?? null);
  const minutes = estimatedMinutes(count, quiz.difficulty ?? null);
  const title = `${quiz.title} – ${count} Questions | StudyAssistant`;

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-background to-muted/30">
      {/* Crawlers get real OG tags from the backend; this keeps the browser tab
          and any JS-capable scraper correct. Shared content stays noindex. */}
      <Seo title={title} noindex path={`/quiz/share/${shareId}`} />

      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link to="/" aria-label="StudyAssistant home">
          <BrandLogo />
        </Link>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          Try StudyAssistant
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        {view === "landing" && (
          <GlassCard className="flex flex-col p-6">
            <span
              className={cn(
                "self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                diff.className,
              )}
            >
              {diff.label}
            </span>
            <h1 className="mt-3 font-display text-2xl font-bold">
              {quiz.title}
            </h1>
            {quiz.topic && (
              <p className="mt-1 text-sm text-muted-foreground">{quiz.topic}</p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Test your knowledge with this {count}-question
              {quiz.topic ? ` ${quiz.topic}` : ""} quiz. Attempt it instantly —
              no sign-up needed.
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <Metric icon={HelpCircle} label="Questions" value={String(count)} />
              <Metric icon={Gauge} label="Level" value={diff.label} />
              <Metric icon={Clock} label="Est. time" value={`${minutes}m`} />
            </div>

            <Button
              onClick={() => setView("run")}
              className="mt-6 w-full gap-2 bg-brand-gradient text-white"
            >
              <Play className="h-4 w-4" /> Start Quiz
            </Button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Generated by StudyAssistant
            </p>
          </GlassCard>
        )}

        {view === "run" && (
          <GlassCard className="flex flex-1 flex-col overflow-hidden p-0">
            <header className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
              <ListChecks className="h-5 w-5 text-brand-1" />
              <h2 className="font-display text-base font-bold">{quiz.title}</h2>
            </header>
            <QuizRunner
              quiz={quiz}
              onSubmit={handleSubmit}
              onSubmitted={(res) => {
                setResult(res);
                setView("report");
              }}
            />
          </GlassCard>
        )}

        {view === "report" && result && (
          <GlassCard className="flex flex-1 flex-col overflow-hidden p-0">
            <QuizAttemptReport
              quiz={quiz}
              evaluation={result.evaluation}
              attemptId={result.attempt_id}
              guest
              onClose={() => setView("landing")}
              onRetake={() => {
                setResult(null);
                setView("run");
              }}
            />
          </GlassCard>
        )}
      </main>
    </div>
  );
}

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
