import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QuizSetupPopover } from "@/components/chat/QuizSetupPopover";
import { BookmarkButton } from "@/components/BookmarkButton";
import { PRIMARY_ACTIONS, type PrimaryAction } from "@/lib/suggestedActions";
import { cn } from "@/lib/utils";
import type { CreateBookmarkInput, QuizOptions } from "@/types";

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
}: {
  content: string;
  busy: boolean;
  topic: string;
  mediaAvailable: boolean;
  quizBusy: boolean;
  bookmarkItem: CreateBookmarkInput;
  onAction: (prompt: string, displayText?: string) => void;
  onGenerateQuiz: (options: QuizOptions) => void;
}) {
  // Which chip triggered the in-flight request (drives its spinner).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The request finishes when streaming stops; clear the spinner.
  useEffect(() => {
    if (!busy) setActiveId(null);
  }, [busy]);

  const fire = (action: PrimaryAction, prompt: string) => {
    if (busy) return;
    setActiveId(action.id);
    // Show a short label in the chat; send the content-bound prompt.
    onAction(prompt, action.label);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Response copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="mt-3">
      {/* Primary actions — animated, quiz-forward */}
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
                  className={cn(
                    "group relative inline-flex items-center gap-1.5",
                    "overflow-hidden rounded-full bg-brand-gradient px-3.5",
                    "py-1.5 text-xs font-semibold text-white shadow-glow",
                    "disabled:opacity-60",
                  )}
                >
                  <motion.span
                    aria-hidden
                    animate={{ rotate: [0, 12, -8, 0], scale: [1, 1.15, 1] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </motion.span>
                  {action.label}
                  {/* shine sweep on hover */}
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                </motion.button>
              </QuizSetupPopover>
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
                  onClick={() =>
                    fire(action, action.buildPrompt?.(content) ?? "")
                  }
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

      {/* Secondary utility actions — small icon buttons */}
      <div className="mt-2.5 flex items-center gap-0.5 border-t border-border/40 pt-2">
        <BookmarkButton item={bookmarkItem} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={copy}
          aria-label="Copy response"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
