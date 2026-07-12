import type { ReactNode } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import type {
  Difficulty,
  ExamConfig,
  QuestionType,
  QuizOptions,
  QuizSetupDraft,
} from "@/types";

/**
 * The one and only Quiz Configuration UI. A bottom sheet on mobile and a
 * centered dialog on desktop (via {@link ResponsiveModal}), it wraps the shared
 * {@link QuizSetupForm}. Every entry point — the answer-card chip, a "make a
 * quiz" chat message, follow-up suggestions, the /quiz toolbar command — opens
 * this same controlled component, so there is a single implementation to
 * maintain and behaviour is identical everywhere.
 *
 * Fully controlled: pass `open` + `onOpenChange`. Provide `trigger` to render
 * an element that opens it (chips), or omit it and drive `open` directly (the
 * chat-requested flow).
 */
export function QuizSetup({
  open,
  onOpenChange,
  trigger,
  initialTopic,
  initialCount,
  initialTypes,
  initialDifficulty,
  initialExamConfig,
  draft,
  onDraftChange,
  mediaAvailable,
  busy,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  initialTopic?: string;
  initialCount?: number | null;
  initialTypes?: QuestionType[] | null;
  initialDifficulty?: Difficulty | null;
  initialExamConfig?: ExamConfig | null;
  /** Form snapshot restored when the popup is reopened after a dismiss. */
  draft?: QuizSetupDraft | null;
  onDraftChange?: (draft: QuizSetupDraft) => void;
  mediaAvailable?: boolean;
  busy?: boolean;
  onGenerate: (options: QuizOptions) => void;
}) {
  const handleGenerate = (opts: QuizOptions) => {
    onOpenChange(false);
    onGenerate(opts);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <ResponsiveModalTrigger asChild>{trigger}</ResponsiveModalTrigger>
      )}
      <ResponsiveModalContent className="h-[90dvh] max-h-[90dvh] sm:h-auto sm:max-h-[90vh]">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="font-display">
            Set up your quiz
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <QuizSetupForm
          layout="sheet"
          initialTopic={initialTopic}
          initialCount={initialCount}
          initialTypes={initialTypes}
          initialDifficulty={initialDifficulty}
          initialExamConfig={initialExamConfig}
          draft={draft}
          onDraftChange={onDraftChange}
          mediaAvailable={mediaAvailable}
          busy={busy}
          onGenerate={handleGenerate}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
