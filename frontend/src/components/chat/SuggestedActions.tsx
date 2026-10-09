import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  FileCheck2,
  ListChecks,
  ArrowUpRight,
  Bookmark,
  Check,
  Copy,
  Loader2,
  NotebookPen,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { QuizSetupPopover } from "@/components/chat/QuizSetupPopover";
import { BookmarkButton } from "@/components/BookmarkButton";
import { PRIMARY_ACTIONS, type PrimaryAction } from "@/lib/suggestedActions";
import { cn } from "@/lib/utils";
import type {
  CreateBookmarkInput,
  QuizOptions,
  SuggestedFollowup,
} from "@/types";

export type FeedbackRating = "up" | "down";

// Border-only "premium AI action" chip (Linear / Raycast / Gemini feel).
const HIGHLIGHT_CHIP = cn(
  "group inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full",
  "border border-brand-1/40 bg-background px-3.5 py-2 text-xs font-semibold",
  "text-foreground transition-all hover:border-brand-1/60",
  "hover:bg-brand-1/[0.04] disabled:opacity-60",
);

// Footer utility button: icon that expands to a label on hover (mouse), a
// 36px tall target on touch. The invisible `before:` box widens the tap area
// to >= 44px without changing how the row looks.
const FOOTER_BUTTON = cn(
  "group relative inline-flex h-7 items-center rounded-full px-2 text-muted-foreground",
  "touch:h-9 touch:px-2.5 transition-colors hover:bg-accent hover:text-foreground",
  "before:absolute before:-inset-1 before:content-['']",
  "disabled:pointer-events-none disabled:opacity-50",
);
const FOOTER_LABEL = cn(
  "max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 transition-all",
  "duration-200 ease-out group-hover:ml-1.5 group-hover:max-w-[90px] group-hover:opacity-100",
);

// "Keep this answer" actions: Aeva writes a note from this card and saves it
// to Notes (backend `notes_generator`). The instruction is the whole request:
// the backend's notes route matches these sentences
// (orchestration/notes_intent.py, pinned by test_notes_generator.py), so
// change them on both sides together.
export type NoteActionKind = "revision_sheet" | "important_questions";
const NOTE_ACTIONS: {
  id: NoteActionKind;
  label: string;
  icon: LucideIcon;
  instruction: string;
}[] = [
  {
    id: "revision_sheet",
    label: "Save as revision sheet",
    icon: FileCheck2,
    instruction: "Make a revision sheet from this.",
  },
  {
    id: "important_questions",
    label: "Important questions",
    icon: ListChecks,
    instruction:
      "List the important questions on this, with short model answers.",
  },
];
// Same border-only look as the Create Quiz / Flashcards chips. On touch each
// is a 44px target in a two-column row (labels wrap inside); with a mouse
// they are the same pills as their neighbours.
const NOTE_CHIP = cn(
  "group inline-flex min-h-[44px] min-w-0 items-center gap-1.5 rounded-xl",
  "border border-brand-1/40 bg-background px-3 py-1.5 text-left text-xs",
  "font-semibold leading-tight text-foreground transition-colors",
  "hover:border-brand-1/60 hover:bg-brand-1/[0.04] disabled:opacity-60",
  "mouse:min-h-0 mouse:rounded-full mouse:px-3.5 mouse:py-2",
);
// Backend action keys that mark an answer as study content worth keeping.
const STUDY_ACTION_KEYS = new Set(["QUIZ", "FLASHCARDS", "SUMMARY"]);

// Why Bookmark / Save note / thumbs wait on a reply that was just streamed.
const NOT_SAVED_YET = "One moment — this reply is still being saved.";

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
  canPersist = true,
  hideGenerators = false,
  feedback = null,
  onAction,
  onFollowup,
  onGenerateQuiz,
  onCreateFlashcards,
  onCopy,
  onSaveNote,
  onMakeNotes,
  onFeedback,
  onRegenerate,
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
  /** False while the message only has a client-side placeholder id: Bookmark,
   * Save note and feedback stay visible but disabled (a `stream-…` id must
   * never be persisted). */
  canPersist?: boolean;
  /** Hide "Create Quiz / Flashcards" (meta or very short answers have no
   * study content to generate from). */
  hideGenerators?: boolean;
  /** Current thumbs rating of this answer. */
  feedback?: FeedbackRating | null;
  onAction: (message: string) => void;
  /** Send a follow-up: the hidden `prompt` is sent, `title` is displayed. */
  onFollowup: (prompt: string, title: string) => void;
  onGenerateQuiz: (options: QuizOptions) => void;
  onCreateFlashcards: () => void;
  onCopy: () => Promise<boolean>;
  /** Save this answer as an editable note; resolves true on success. */
  onSaveNote?: () => Promise<boolean>;
  /** Have Aeva write a saved note from this answer (the instruction is
   * sent as the message). Omit to hide the note actions. */
  onMakeNotes?: (instruction: string) => void;
  /** Rate the answer (`null` clears the rating); resolves true on success. */
  onFeedback?: (rating: FeedbackRating | null) => Promise<boolean>;
  /** Re-send the question that produced this answer (latest answer only). */
  onRegenerate?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [ratingBusy, setRatingBusy] = useState(false);
  const reduce = useReducedMotion();

  // Render only the actions the backend exposed for this response. Undefined
  // (e.g. older messages) falls back to the full set for compatibility.
  const visibleActions = (
    availableActions
      ? PRIMARY_ACTIONS.filter((a) => availableActions.includes(a.key))
      : PRIMARY_ACTIONS
  ).filter((a) => !hideGenerators || a.kind === "prompt");
  // Note actions follow the generators: only on an answer with study content.
  const showNoteActions =
    !!onMakeNotes &&
    showSuggestions &&
    !hideGenerators &&
    (!availableActions ||
      availableActions.some((key) => STUDY_ACTION_KEYS.has(key)));

  useEffect(() => {
    if (!busy) setActiveId(null);
  }, [busy]);

  const firePrompt = (action: PrimaryAction) => {
    if (busy || !action.instruction) return;
    analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, {
      action: "primary_prompt",
      action_id: action.id,
    });
    setActiveId(action.id);
    onAction(action.instruction);
  };

  const fireFlashcards = (action: PrimaryAction) => {
    if (busy) return;
    analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, {
      action: "flashcards",
      action_id: action.id,
    });
    setActiveId(action.id);
    onCreateFlashcards();
  };

  const fireNotes = (action: (typeof NOTE_ACTIONS)[number]) => {
    if (busy || !onMakeNotes) return;
    analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, {
      action: "make_notes",
      action_id: action.id,
    });
    setActiveId(action.id);
    onMakeNotes(action.instruction);
  };

  const copy = async () => {
    analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, { action: "copy" });
    const ok = await onCopy();
    if (ok) {
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const rate = async (rating: FeedbackRating) => {
    if (!onFeedback || ratingBusy) return;
    if (!canPersist) {
      toast.info(NOT_SAVED_YET);
      return;
    }
    setRatingBusy(true);
    // Tapping the active thumb clears the rating.
    const ok = await onFeedback(feedback === rating ? null : rating);
    setRatingBusy(false);
    if (ok && feedback !== rating) {
      toast.success(
        rating === "up" ? "Thanks for the feedback!" : "Thanks — I'll do better.",
      );
    }
  };

  const regenerate = () => {
    if (!onRegenerate || busy) return;
    analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, { action: "regenerate" });
    onRegenerate();
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

      {/* Keep this answer: a saved revision sheet / important questions. */}
      {showNoteActions && (
        <motion.div
          variants={container}
          initial={reduce ? false : "hidden"}
          animate="show"
          className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          {NOTE_ACTIONS.map((action) => {
            const Icon = action.icon;
            const loading = busy && activeId === action.id;
            return (
              <motion.button
                key={action.id}
                type="button"
                variants={chip}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                disabled={busy}
                onClick={() => fireNotes(action)}
                data-analytics-name={action.label}
                className={NOTE_CHIP}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-1" />
                ) : (
                  <Icon className="h-3.5 w-3.5 shrink-0 text-brand-1" />
                )}
                <span className="min-w-0">{action.label}</span>
              </motion.button>
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
              onClick={() => {
                if (busy) return;
                analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, {
                  action: "followup",
                  followup_index: i,
                });
                onFollowup(f.prompt, f.title);
              }}
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

      {/* Secondary utility actions — icons that expand to labels on hover.
         Wraps on narrow phones; feedback + regenerate sit at the far end. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-border/40 pt-2">
        {canPersist ? (
          <BookmarkButton item={bookmarkItem} hoverExpand />
        ) : (
          // Same look as the real button, but a tap only explains the wait:
          // the reply's persisted id has not arrived yet.
          <button
            type="button"
            aria-disabled="true"
            aria-label="Bookmark (available in a moment)"
            title={NOT_SAVED_YET}
            onClick={() => toast.info(NOT_SAVED_YET)}
            className={cn(FOOTER_BUTTON, "opacity-50")}
          >
            <Bookmark className="h-3.5 w-3.5 shrink-0" />
            <span className={FOOTER_LABEL}>Bookmark</span>
          </button>
        )}
        {onSaveNote && (
          <button
            type="button"
            onClick={async () => {
              if (noteState !== "idle") return;
              if (!canPersist) {
                toast.info(NOT_SAVED_YET);
                return;
              }
              analytics.track(AnalyticsEvent.CHAT_ACTION_CLICKED, {
                action: "save_note",
              });
              setNoteState("saving");
              const ok = await onSaveNote();
              setNoteState(ok ? "saved" : "idle");
              if (ok) window.setTimeout(() => setNoteState("idle"), 2000);
            }}
            aria-label="Save as note"
            aria-disabled={!canPersist}
            title={canPersist ? undefined : NOT_SAVED_YET}
            className={cn(FOOTER_BUTTON, !canPersist && "opacity-50")}
          >
            {noteState === "saving" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : noteState === "saved" ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <NotebookPen className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className={FOOTER_LABEL}>
              {noteState === "saved" ? "Saved" : "Save note"}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="Copy response"
          className={FOOTER_BUTTON}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Copy className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className={FOOTER_LABEL}>{copied ? "Copied" : "Copy"}</span>
        </button>

        {(onFeedback || (onRegenerate && showSuggestions)) && (
          <span className="ml-auto flex items-center gap-1">
            {onFeedback && (
              <>
                <button
                  type="button"
                  onClick={() => rate("up")}
                  aria-label="Good answer"
                  aria-pressed={feedback === "up"}
                  aria-disabled={!canPersist}
                  title={canPersist ? "Good answer" : NOT_SAVED_YET}
                  className={cn(
                    FOOTER_BUTTON,
                    feedback === "up" && "text-brand-1",
                    !canPersist && "opacity-50",
                  )}
                >
                  <ThumbsUp
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      feedback === "up" && "fill-current",
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => rate("down")}
                  aria-label="Not helpful"
                  aria-pressed={feedback === "down"}
                  aria-disabled={!canPersist}
                  title={canPersist ? "Not helpful" : NOT_SAVED_YET}
                  className={cn(
                    FOOTER_BUTTON,
                    feedback === "down" && "text-brand-1",
                    !canPersist && "opacity-50",
                  )}
                >
                  <ThumbsDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      feedback === "down" && "fill-current",
                    )}
                  />
                </button>
              </>
            )}
            {onRegenerate && showSuggestions && (
              <button
                type="button"
                onClick={regenerate}
                disabled={busy}
                aria-label="Regenerate answer"
                className={FOOTER_BUTTON}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                <span className={FOOTER_LABEL}>Regenerate</span>
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
