import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QuizSetupPopover } from "@/components/chat/QuizSetupPopover";
import { BookmarkButton } from "@/components/BookmarkButton";
import { PRIMARY_ACTIONS, type PrimaryAction } from "@/lib/suggestedActions";
import { cn } from "@/lib/utils";
import type { CreateBookmarkInput, QuizOptions } from "@/types";

// Border-only "premium AI action" chip (Linear / Raycast / Gemini feel).
const HIGHLIGHT_CHIP = cn(
  "group inline-flex items-center gap-1.5 rounded-full border",
  "border-brand-1/40 bg-background px-3.5 py-1.5 text-xs font-semibold",
  "text-foreground transition-all hover:border-brand-1/70",
  "hover:shadow-[0_0_12px_-2px_hsl(var(--brand-1)/0.5)] disabled:opacity-60",
);

function AnimatedIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <motion.span
      aria-hidden
      className="text-brand-1 transition-transform group-hover:scale-110"
      animate={{ rotate: [0, 14, -10, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <Icon className="h-3.5 w-3.5" />
    </motion.span>
  );
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.04 },
  },
};

const chip = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 420, damping: 26 },
  },
};

export function SuggestedActions({
  content,
  busy,
  topic,
  mediaAvailable,
  quizBusy,
  bookmarkItem,
  onAction,
  onGenerateQuiz,
  onCreateFlashcards,
  onCopy,
}: {
  busy: boolean;
  topic: string;
  mediaAvailable: boolean;
  quizBusy: boolean;
  bookmarkItem: CreateBookmarkInput;
  onAction: (message: string) => void;
  onGenerateQuiz: (options: QuizOptions) => void;
  onCreateFlashcards: () => void;
  onCopy: () => Promise<boolean>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!busy) setActiveId(null);
  }, [busy]);

  const firePrompt = (action: PrimaryAction) => {
    if (busy || !action.instruction) return;
    setActiveId(action.id);
    onAction(action.instruction);
  };

  const fireFlashcards = (action: PrimaryAction) => {
    if (busy) return;
    setActiveId(action.id);
    onCreateFlashcards();
  };

  const copy = async () => {
    const ok = await onCopy();
    if (ok) {
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="mt-3">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-wrap gap-2"
      >
        {PRIMARY_ACTIONS.map((action) => {
          const Icon = action.icon;
          const loading = busy && activeId === action.id;

          if (action.kind === "quiz") {
            return (
              <QuizSetupPopover
                key={action.id}
                initialTopic={topic}
                mediaAvailable={mediaAvailable}
                busy={quizBusy}
                onGenerate={onGenerateQuiz}
              >
                <motion.button
                  type="button"
                  variants={chip}
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  disabled={busy}
                  className={HIGHLIGHT_CHIP}
                >
                  <AnimatedIcon Icon={Icon} />
                  {action.label}
                </motion.button>
              </QuizSetupPopover>
            );
          }

          if (action.kind === "flashcards") {
            return (
              <motion.button
                key={action.id}
                type="button"
                variants={chip}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.97 }}
                disabled={busy}
                className={HIGHLIGHT_CHIP}
                onClick={() => fireFlashcards(action)}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-1" />
                ) : (
                  <AnimatedIcon Icon={Icon} />
                )}
                {action.label}
              </motion.button>
            );
          }

          // kind === "prompt"
          return (
            <motion.div key={action.id} variants={chip}>
              <motion.div
                whileHover={{ scale: 1.04, y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 rounded-full px-3 text-xs"
                  disabled={busy}
                  onClick={() => firePrompt(action)}
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {action.label}
                </Button>
              </motion.div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Secondary utility actions — icons that expand to labels on hover */}
      <div className="mt-2.5 flex items-center gap-1 border-t border-border/40 pt-2">
        <BookmarkButton item={bookmarkItem} hoverExpand />
        <button
          type="button"
          onClick={copy}
          aria-label="Copy response"
          className="group inline-flex h-7 items-center rounded-full px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all duration-200 ease-out group-hover:ml-1.5 group-hover:max-w-[80px] group-hover:opacity-100">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
    </div>
  );
}
