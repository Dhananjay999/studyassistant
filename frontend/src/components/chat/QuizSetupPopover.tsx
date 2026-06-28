import { useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import { useIsMobile } from "@/hooks/use-mobile";
import type { QuizOptions } from "@/types";

/** "Generate Quiz" entry point on an answer card. Anchored popover on desktop,
 * a drag-dismissable bottom sheet on mobile (more room for the form + thumb
 * reach). */
export function QuizSetupPopover({
  children,
  initialTopic,
  mediaAvailable,
  busy,
  onGenerate,
}: {
  children: ReactNode;
  initialTopic?: string;
  mediaAvailable?: boolean;
  busy?: boolean;
  onGenerate: (options: QuizOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleGenerate = (opts: QuizOptions) => {
    setOpen(false);
    onGenerate(opts);
  };

  if (isMobile) {
    return (
      <ResponsiveModal open={open} onOpenChange={setOpen}>
        <ResponsiveModalTrigger asChild>{children}</ResponsiveModalTrigger>
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle className="font-display">
              Set up your quiz
            </ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="pb-2 pt-1">
            <QuizSetupForm
              initialTopic={initialTopic}
              mediaAvailable={mediaAvailable}
              busy={busy}
              onGenerate={handleGenerate}
            />
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-3 font-display text-sm font-semibold">
          Set up your quiz
        </p>
        <QuizSetupForm
          initialTopic={initialTopic}
          mediaAvailable={mediaAvailable}
          busy={busy}
          onGenerate={handleGenerate}
        />
      </PopoverContent>
    </Popover>
  );
}
