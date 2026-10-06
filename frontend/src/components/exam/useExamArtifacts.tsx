// One QuizDrawer + one FlashcardViewer per Exam Prep page, shared by every
// topic row, the action sheet and the exam chat. Rows call `openQuizById` /
// `openFlashcards`; the heavy components are lazy-loaded on first use and
// kept mounted afterwards so their close animations and state survive.

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getQuiz } from "@/lib/api";
import type { QuizContent } from "@/types";

const QuizDrawer = lazy(() =>
  import("@/components/chat/QuizDrawer").then((m) => ({
    default: m.QuizDrawer,
  })),
);
const FlashcardViewer = lazy(() =>
  import("@/components/chat/FlashcardViewer").then((m) => ({
    default: m.FlashcardViewer,
  })),
);

interface ExamArtifacts {
  /** Open a quiz the caller already has (e.g. from a chat card). */
  openQuiz: (quiz: QuizContent) => void;
  /** Fetch a quiz by id and open it; resolves false when the load failed. */
  openQuizById: (quizId: string) => Promise<boolean>;
  openFlashcards: (setId: string) => void;
  /** Quiz id currently being fetched (for a per-row spinner). */
  loadingQuizId: string | null;
}

const ExamArtifactsContext = createContext<ExamArtifacts | null>(null);

export function ExamArtifactsProvider({ children }: { children: ReactNode }) {
  const [activeQuiz, setActiveQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeSet, setActiveSet] = useState<string | null>(null);
  const [setOpen, setSetOpen] = useState(false);
  const [loadingQuizId, setLoadingQuizId] = useState<string | null>(null);

  const openQuiz = useCallback((quiz: QuizContent) => {
    setActiveQuiz(quiz);
    setQuizOpen(true);
  }, []);

  const openQuizById = useCallback(
    async (quizId: string) => {
      setLoadingQuizId(quizId);
      try {
        const quiz = await getQuiz(quizId);
        openQuiz(quiz);
        return true;
      } catch {
        toast.error("Couldn't open the quiz. Please try again.");
        return false;
      } finally {
        setLoadingQuizId(null);
      }
    },
    [openQuiz],
  );

  const openFlashcards = useCallback((setId: string) => {
    setActiveSet(setId);
    setSetOpen(true);
  }, []);

  const value = useMemo<ExamArtifacts>(
    () => ({ openQuiz, openQuizById, openFlashcards, loadingQuizId }),
    [openQuiz, openQuizById, openFlashcards, loadingQuizId],
  );

  return (
    <ExamArtifactsContext.Provider value={value}>
      {children}
      {activeQuiz && (
        <Suspense fallback={null}>
          <QuizDrawer
            quiz={activeQuiz}
            open={quizOpen}
            onOpenChange={setQuizOpen}
            initialView="run"
            source="exam_prep"
          />
        </Suspense>
      )}
      {activeSet && (
        <Suspense fallback={null}>
          <FlashcardViewer
            setId={activeSet}
            open={setOpen}
            onOpenChange={setSetOpen}
            source="exam_prep"
          />
        </Suspense>
      )}
    </ExamArtifactsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useExamArtifacts(): ExamArtifacts {
  const ctx = useContext(ExamArtifactsContext);
  if (!ctx) {
    throw new Error("useExamArtifacts must be used within ExamArtifactsProvider");
  }
  return ctx;
}
