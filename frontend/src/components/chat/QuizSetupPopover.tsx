import { useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import type { QuizOptions } from "@/types";

/** "Generate Quiz" entry point on an answer card. */
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
          onGenerate={(opts) => {
            setOpen(false);
            onGenerate(opts);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
