import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import { SourcePicker } from "@/components/create/SourcePicker";
import { useGenerateQuiz } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import {
  EMPTY_SOURCE,
  toGenerationSource,
  type SourceDraft,
} from "@/lib/generationSource";
import type { QuizOptions, QuizSetupDraft } from "@/types";

/**
 * Quiz Creation Panel for the Quizzes page — the direct entry point into the
 * same quiz generator Chat uses. A source picker (topic, files or a note) sits
 * on top of the shared {@link QuizSetupForm}; Generate closes the panel and the
 * quiz is built in the background, landing in the library when ready (the
 * page shows a placeholder card meanwhile).
 */
export function CreateQuizPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const generate = useGenerateQuiz();
  // Both drafts outlive the modal content so a dismiss never loses input.
  const [source, setSource] = useState<SourceDraft>(EMPTY_SOURCE);
  const settingsDraft = useRef<QuizSetupDraft | null>(null);
  const material = toGenerationSource(source);
  const stashSettings = useCallback((d: QuizSetupDraft) => {
    settingsDraft.current = d;
  }, []);

  const handleGenerate = (opts: QuizOptions) => {
    if (!material) return;
    analytics.track(AnalyticsEvent.QUIZ_GENERATION_REQUESTED, {
      question_count: opts.question_count ?? 0,
      difficulty: opts.difficulty ?? "default",
      question_types: opts.question_types ?? [],
      use_media: material.source === "files",
      is_exam: !!opts.exam_config,
      has_topic: !!material.topic,
      has_instructions: !!opts.additional_instructions,
      source: "quizzes_page",
      material: material.source,
    });
    onOpenChange(false);
    setSource(EMPTY_SOURCE);
    settingsDraft.current = null;

    // mutateAsync (not mutate callbacks) so the outcome toast still fires if
    // the user navigates away while the quiz is being generated.
    generate
      .mutateAsync({
        ...material,
        question_count: opts.question_count,
        difficulty: opts.difficulty,
        question_types: opts.question_types,
        additional_instructions: opts.additional_instructions,
        exam_config: opts.exam_config,
      })
      .then(
        (quiz) =>
          toast.success("Your quiz is ready", {
            description: quiz.title,
            action: {
              label: "Start quiz",
              onClick: () => navigate(`/quizzes?quizId=${quiz.quiz_id}`),
            },
          }),
        (err) => {
          analytics.track(AnalyticsEvent.QUIZ_CREATE_FAILED, {
            error_kind: errorKind(err),
            material: material.source,
          });
          toast.error("Couldn't create your quiz", {
            description: friendlyErrorMessage(err),
          });
        },
      );
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="h-[90dvh] max-h-[90dvh] sm:h-auto sm:max-h-[90vh]">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="font-display">
            Create a quiz
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Pick what to practice and Aeva will add the quiz to your library.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <QuizSetupForm
          layout="sheet"
          hideTopic
          leading={
            <SourcePicker
              question="What do you want to be quizzed on?"
              value={source}
              onChange={setSource}
            />
          }
          canGenerate={material !== null}
          draft={settingsDraft.current}
          onDraftChange={stashSettings}
          onGenerate={handleGenerate}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
