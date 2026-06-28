import { useEffect, useState } from "react";
import { History, Loader2, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { QuizRunner } from "@/components/quiz/QuizRunner";
import { QuizAttemptReport } from "@/components/quiz/QuizAttemptReport";
import { QuizAttemptsTab } from "@/components/quiz/QuizAttemptsTab";
import { useQuizAttempt } from "@/hooks/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { QuizContent, QuizSubmitResult } from "@/types";

type View = "menu" | "run" | "report";
type Tab = "take" | "attempts";

/** How the dashboard opens: a freshly-opened quiz jumps straight into taking
 * ("run"); the library opens the dashboard on a chosen tab. */
export type QuizInitialView = "run" | "take" | "attempts";

/**
 * Quiz dashboard. A reusable learning resource: take new attempts, browse the
 * full attempt history, and open any attempt as a permanent report card.
 * Desktop is a centered modal (~960px / 85vh); mobile is full-screen.
 */
export function QuizDrawer({
  quiz,
  open,
  onOpenChange,
  initialView = "run",
}: {
  quiz: QuizContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView?: QuizInitialView;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>("menu");
  const [tab, setTab] = useState<Tab>("take");
  const [freshResult, setFreshResult] = useState<QuizSubmitResult | null>(null);
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null);

  const quizId = quiz?.quiz_id ?? "";

  // (Re)initialise the dashboard whenever a quiz is opened or the entry point
  // changes. A freshly-opened quiz goes straight into a new attempt.
  useEffect(() => {
    if (!open) return;
    setFreshResult(null);
    setOpenAttemptId(null);
    if (initialView === "run") {
      setView("run");
      setTab("take");
    } else {
      setView("menu");
      setTab(initialView);
    }
  }, [open, quiz?.quiz_id, initialView]);

  // Historical attempt detail (only fetched while viewing a saved attempt).
  const attemptQuery = useQuizAttempt(
    quizId,
    view === "report" && !freshResult ? openAttemptId : null,
  );
  const detail = attemptQuery.data;

  if (!quiz) return null;

  const backToAttempts = () => {
    setFreshResult(null);
    setOpenAttemptId(null);
    setView("menu");
    setTab("attempts");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isMobile
            ? "h-dvh w-screen max-w-none rounded-none border-0"
            : "h-[85vh] w-[min(960px,95vw)] max-w-none rounded-2xl",
        )}
      >
        <DialogTitle className="sr-only">{quiz.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Take the quiz, review attempts, and track your progress.
        </DialogDescription>

        {view === "report" ? (
          freshResult ? (
            <QuizAttemptReport
              quiz={quiz}
              evaluation={freshResult.evaluation}
              attemptId={freshResult.attempt_id}
              onClose={() => onOpenChange(false)}
              onBack={backToAttempts}
            />
          ) : detail ? (
            <QuizAttemptReport
              quiz={detail.quiz}
              evaluation={detail.evaluation}
              attemptId={detail.attempt_id}
              attemptNumber={detail.attempt_number}
              initialAnalysis={detail.ai_analysis}
              onClose={() => onOpenChange(false)}
              onBack={backToAttempts}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : view === "run" ? (
          <>
            <header className="border-b border-border/50 px-5 pr-12 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4">
              <h2 className="font-display text-lg font-bold">{quiz.title}</h2>
            </header>
            <QuizRunner
              quiz={quiz}
              onSubmitted={(res) => {
                setFreshResult(res);
                setView("report");
              }}
            />
          </>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <header className="space-y-3 border-b border-border/50 px-5 pr-12 pt-[calc(env(safe-area-inset-top)+1rem)] pb-4">
              <h2 className="font-display text-lg font-bold">{quiz.title}</h2>
              <TabsList className="grid w-full max-w-xs grid-cols-2">
                <TabsTrigger value="take">Take Quiz</TabsTrigger>
                <TabsTrigger value="attempts">Attempts</TabsTrigger>
              </TabsList>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-6">
              <TabsContent value="take" className="mt-0">
                <TakePanel
                  quiz={quiz}
                  onStart={() => setView("run")}
                  onViewAttempts={() => setTab("attempts")}
                />
              </TabsContent>
              <TabsContent value="attempts" className="mt-0">
                <QuizAttemptsTab
                  quizId={quizId}
                  onStartAttempt={() => setView("run")}
                  onOpenAttempt={(attemptId) => {
                    setFreshResult(null);
                    setOpenAttemptId(attemptId);
                    setView("report");
                  }}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TakePanel({
  quiz,
  onStart,
  onViewAttempts,
}: {
  quiz: QuizContent;
  onStart: () => void;
  onViewAttempts: () => void;
}) {
  const count = quiz.questions?.length ?? 0;
  return (
    <div className="mx-auto grid max-w-md place-items-center py-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
        <Play className="h-6 w-6" />
      </div>
      <h3 className="mt-4 font-display text-xl font-bold">Ready to start?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {count} question{count === 1 ? "" : "s"} · scored instantly. Every
        attempt is saved so you can track your progress.
      </p>
      <Button
        onClick={onStart}
        className="mt-5 w-full gap-2 bg-brand-gradient text-white"
      >
        <Play className="h-4 w-4" /> Start New Attempt
      </Button>
      <Button
        variant="ghost"
        onClick={onViewAttempts}
        className="mt-2 gap-1.5 text-muted-foreground"
      >
        <History className="h-4 w-4" /> View past attempts
      </Button>
    </div>
  );
}
