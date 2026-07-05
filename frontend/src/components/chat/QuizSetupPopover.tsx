import { useState, type ReactNode } from "react";
import { QuizSetup } from "@/components/chat/QuizSetup";
import type { QuizOptions } from "@/types";

/** "Generate Quiz" chip entry point. A thin trigger wrapper around the shared
 * {@link QuizSetup} — the single Quiz Configuration UI — so every entry point
 * opens the exact same bottom sheet (mobile) / dialog (desktop). */
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
    <QuizSetup
      open={open}
      onOpenChange={setOpen}
      trigger={children}
      initialTopic={initialTopic}
      mediaAvailable={mediaAvailable}
      busy={busy}
      onGenerate={onGenerate}
    />
  );
}
