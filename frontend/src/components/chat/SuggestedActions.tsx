import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { QuizSetupPopover } from "@/components/chat/QuizSetupPopover";
import { BookmarkButton } from "@/components/BookmarkButton";
import { PRIMARY_ACTIONS, type PrimaryAction } from "@/lib/suggestedActions";
import { cn } from "@/lib/utils";
import type {
  CreateBookmarkInput,
  QuizOptions,
  SuggestedFollowup,
} from "@/types";

// Border-only "premium AI action" chip (Linear / Raycast / Gemini feel).
const HIGHLIGHT_CHIP = cn(
  "group inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full",
  "border border-brand-1/40 bg-background px-3.5 py-2 text-xs font-semibold",
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
  availableActions,
  suggestedFollowups,
  showSuggestions = true,
  busy,
  topic,
  mediaAvailable,
  quizBusy,
  bookmarkItem,
  onAction,
  onFollowup,
  onGenerateQuiz,
  onCreateFlashcards,
  onCopy,
}: {
  /** Action keys the backend says apply to this response (undefined = all). */
  availableActions?: string[];
  /** AI-generated next questions (display title + hidden richer prompt). */
  suggestedFollowups?: SuggestedFollowup[];
  /** Show action + follow-up chips (only the latest answer); older cards keep
   * just Bookmark + Copy. */
  showSuggestions?: boolean;
  busy: boolean;
  topic: string;
  mediaAvailable: boolean;
  quizBusy: boolean;
  bookmarkItem: CreateBookmarkInput;
  onAction: (message: string) => void;
  /** Send a follow-up: the hidden `prompt` is sent, `title` is displayed. */
  onFollowup: (prompt: string, title: string) => void;
  onGenerateQuiz: (options: QuizOptions) => void;
  onCreateFlashcards: () => void;
  onCopy: () => Promise<boolean>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Render only the actions the backend exposed for this response. Undefined
  // (e.g. older messages) falls back to the full set for compatibility.
  const visibleActions = availableActions
    ? PRIMARY_ACTIONS.filter((a) => availableActions.includes(a.key))
    : PRIMARY_ACTIONS;

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
      {showSuggestions && visibleActions.length > 0 && (
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex snap-x gap-2 overflow-x-auto pb-1 scrollbar-hide sm:flex-wrap sm:overflow-visible sm:pb-0"
      >
        {visibleActions.map((action) => {
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
            <motion.div
              key={action.id}
              variants={chip}
              className="shrink-0 snap-start"
            >
              <motion.div
                whileHover={{ scale: 1.04, y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-full px-3 text-xs"
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
      )}

      {/* AI-generated follow-up questions — tap sends the richer hidden prompt */}
      {showSuggestions && suggestedFollowups && suggestedFollowups.length > 0 && (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="mt-2.5 flex flex-col gap-1.5"
        >
          {suggestedFollowups.map((f, i) => (
            <motion.button
              key={`${f.title}-${i}`}
              type="button"
              variants={chip}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.99 }}
              disabled={busy}
              onClick={() => !busy && onFollowup(f.prompt, f.title)}
              className={cn(
                "group inline-flex w-full items-center justify-between gap-2",
                "rounded-xl border border-border/60 bg-muted/30 px-3 py-2",
                "text-left text-xs font-medium text-foreground/90",
                "transition-colors hover:border-brand-1/50 hover:bg-accent",
                "disabled:opacity-60",
              )}
            >
              <span className="min-w-0 truncate">{f.title}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand-1" />
            </motion.button>
          ))}
        </motion.div>
      )}

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
