import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ChipSelect } from "@/components/learning/ChipSelect";
import {
  useLearningProfile,
  useSaveLearningProfile,
  useSkipPersonalization,
} from "@/hooks/api";
import { useSwipe } from "@/hooks/useSwipe";
import { cn } from "@/lib/utils";
import {
  EDUCATION_LEVELS,
  EXPLANATION_STYLES,
  FAVORITE_SUBJECTS,
  LEARNING_GOALS,
  PREFERRED_LANGUAGES,
} from "@/lib/learningProfile";
import type { LearningProfile } from "@/types";

const OTHER = "Other";

/** Editable answers for the guided flow (the 5 core profile questions). */
interface Draft {
  level: string;
  otherLevel: string;
  language: string;
  style: string;
  subjects: string[];
  goal: string;
}

const EMPTY: Draft = {
  level: "",
  otherLevel: "",
  language: "",
  style: "",
  subjects: [],
  goal: "",
};

/** Smart defaults: seed the draft from a saved profile when editing. */
function toDraft(profile: LearningProfile | undefined | null): Draft {
  if (!profile) return EMPTY;
  const saved = profile.education_level ?? "";
  const known = (EDUCATION_LEVELS as readonly string[]).includes(saved);
  return {
    level: saved ? (known ? saved : OTHER) : "",
    otherLevel: known ? "" : saved,
    language: profile.preferred_language ?? "",
    style: profile.explanation_style ?? "",
    subjects: profile.favorite_subjects ?? [],
    goal: profile.learning_goal ?? "",
  };
}

interface StepDef {
  key: keyof Pick<Draft, "level" | "language" | "style" | "goal"> | "subjects";
  emoji: string;
  title: string;
  hint?: string;
  options: readonly string[];
  multi?: boolean;
  /** Single-select steps render big option rows; multi renders chips. */
  allowOther?: boolean;
}

const STEPS: StepDef[] = [
  {
    key: "level",
    emoji: "🎓",
    title: "What are you studying?",
    hint: "This is the most useful detail for tailoring answers.",
    options: EDUCATION_LEVELS,
    allowOther: true,
  },
  {
    key: "language",
    emoji: "🌍",
    title: "Preferred language?",
    options: PREFERRED_LANGUAGES,
  },
  {
    key: "style",
    emoji: "🧠",
    title: "How should Aeva explain things?",
    options: EXPLANATION_STYLES,
  },
  {
    key: "subjects",
    emoji: "📚",
    title: "Favorite subjects",
    hint: "Pick as many as you like.",
    options: FAVORITE_SUBJECTS,
    multi: true,
  },
  {
    key: "goal",
    emoji: "🎯",
    title: "What are you preparing for?",
    options: LEARNING_GOALS,
  },
];

const TOTAL = STEPS.length;

/** Current display value of a step from the draft. */
function stepValue(draft: Draft, step: StepDef): string {
  if (step.key === "subjects") {
    return draft.subjects.length ? draft.subjects.join(", ") : "";
  }
  const v = draft[step.key];
  return v === OTHER ? draft.otherLevel || OTHER : v;
}

/**
 * Guided, mobile-first personalization: one question per screen, a progress
 * bar, big touch-friendly choices, swipe/slide navigation, and per-step Skip.
 * The same component powers first-run onboarding (welcome → questions →
 * celebration) and step-based editing from Settings (`mode="edit"`: opens on
 * a jump-to-any-question overview, prefilled from the saved profile).
 */
export function OnboardingFlow({
  open,
  onDone,
  mode = "onboarding",
}: {
  open: boolean;
  /** Called after the user completes or skips; parent should dismiss + refresh. */
  onDone: () => void;
  mode?: "onboarding" | "edit";
}) {
  const editing = mode === "edit";
  // Screens: welcome (onboarding) / overview (edit) → question index → done.
  const [screen, setScreen] = useState<"intro" | "question" | "done">("intro");
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const { data: profile } = useLearningProfile();
  const saveMutation = useSaveLearningProfile();
  const skipMutation = useSkipPersonalization();
  const busy = saveMutation.isPending || skipMutation.isPending;

  // Prefill once per open so users never re-enter unchanged information.
  useEffect(() => {
    if (open) {
      setDraft(toDraft(profile));
      setScreen("intro");
      setIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const step = STEPS[idx];

  const goto = (next: number) => {
    setDir(next >= idx ? 1 : -1);
    setIdx(next);
    setScreen("question");
  };

  const handleSkipAll = async () => {
    try {
      if (!editing) await skipMutation.mutateAsync();
    } finally {
      onDone();
    }
  };

  const save = async (): Promise<boolean> => {
    const level = draft.level === OTHER ? draft.otherLevel.trim() : draft.level;
    try {
      await saveMutation.mutateAsync({
        education_level: level || null,
        preferred_language: draft.language || null,
        explanation_style: draft.style || null,
        favorite_subjects: draft.subjects,
        learning_goal: draft.goal || null,
      });
      return true;
    } catch {
      return false; // surfaced via mutation state; stay on the step
    }
  };

  const finish = async () => {
    if (await save()) {
      if (editing) onDone();
      else setScreen("done");
    }
  };

  const next = () => {
    if (editing) {
      setScreen("intro"); // back to the jump overview after each answer
    } else if (idx < TOTAL - 1) {
      goto(idx + 1);
    } else {
      void finish();
    }
  };
  const back = () => {
    if (editing || idx === 0) setScreen("intro");
    else goto(idx - 1);
  };

  // Single-select: choosing an option advances after a short beat, so the
  // flow reads as a conversation rather than select-then-submit.
  const pick = (value: string) => {
    if (step.key === "subjects") return;
    setDraft((d) => ({ ...d, [step.key]: d[step.key] === value ? "" : value }));
    if (value !== OTHER && draft[step.key] !== value) {
      window.setTimeout(next, 260);
    }
  };

  const toggleSubject = (subject: string) =>
    setDraft((d) => ({
      ...d,
      subjects: d.subjects.includes(subject)
        ? d.subjects.filter((s) => s !== subject)
        : [...d.subjects, subject],
    }));

  const swipe = useSwipe({
    onSwipeLeft: () => screen === "question" && !editing && next(),
    onSwipeRight: () => screen === "question" && back(),
  });

  // Closing via X / Escape / overlay: "skip for now" on first run, plain
  // close while editing.
  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !busy) void handleSkipAll();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 pt-safe pb-safe sm:h-auto sm:min-h-[560px] sm:w-full sm:max-w-md sm:rounded-3xl sm:border">
        {screen === "intro" && !editing && (
          <Welcome busy={busy} onStart={() => goto(0)} onSkip={handleSkipAll} />
        )}

        {screen === "intro" && editing && (
          <Overview
            draft={draft}
            busy={busy}
            onJump={goto}
            onSave={() => void finish()}
          />
        )}

        {screen === "question" && (
          <div className="flex min-h-0 flex-1 flex-col" {...swipe}>
            {/* Progress header */}
            <div className="px-5 pb-3 pt-5">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>
                  Step {idx + 1} of {TOTAL}
                </span>
                <button
                  type="button"
                  className="touch-target -mr-2 px-2 text-muted-foreground"
                  onClick={next}
                  disabled={busy}
                >
                  Skip
                </button>
              </div>
              <Progress
                value={((idx + 1) / TOTAL) * 100}
                className="h-1.5 [&>div]:transition-all [&>div]:duration-500"
              />
            </div>

            {/* Question */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: dir * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * -40 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <div className="mb-1 text-4xl" aria-hidden="true">
                    {step.emoji}
                  </div>
                  <DialogTitle className="mt-2 font-display text-xl font-bold">
                    {step.title}
                  </DialogTitle>
                  {step.hint && (
                    <DialogDescription className="mt-1 text-sm">
                      {step.hint}
                    </DialogDescription>
                  )}

                  <div className="mt-5">
                    {step.multi ? (
                      <ChipSelect
                        options={step.options}
                        selected={draft.subjects}
                        onToggle={toggleSubject}
                        className="gap-2.5 [&>button]:px-4 [&>button]:py-2.5"
                      />
                    ) : (
                      <div className="grid gap-2">
                        {[...step.options, ...(step.allowOther ? [OTHER] : [])].map(
                          (option) => {
                            const active = draft[step.key] === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={active}
                                onClick={() => pick(option)}
                                className={cn(
                                  "flex min-h-12 items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors",
                                  active
                                    ? "border-brand-1 bg-brand-1/10 text-brand-1"
                                    : "border-border/70 bg-card/50",
                                )}
                              >
                                {option}
                                {active && (
                                  <Sparkles className="h-4 w-4 shrink-0" />
                                )}
                              </button>
                            );
                          },
                        )}
                        {step.allowOther && draft.level === OTHER && (
                          <Input
                            autoFocus
                            value={draft.otherLevel}
                            onChange={(e) =>
                              setDraft((d) => ({
                                ...d,
                                otherLevel: e.target.value,
                              }))
                            }
                            placeholder="Tell us what you're studying"
                            className="mt-1 h-12 rounded-xl"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between gap-2 border-t border-border/40 px-5 py-3">
              <Button
                variant="ghost"
                onClick={back}
                disabled={busy}
                className="h-11 gap-1 rounded-xl px-3"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button
                onClick={next}
                disabled={busy}
                className={cn(
                  "h-11 flex-1 gap-1 rounded-xl sm:flex-none sm:px-8",
                  idx === TOTAL - 1 && !editing
                    ? "bg-brand-gradient text-white shadow-glow"
                    : "",
                )}
              >
                {busy
                  ? "Saving…"
                  : editing
                    ? "Done"
                    : idx === TOTAL - 1
                      ? "Finish"
                      : "Next"}
                {!busy && idx < TOTAL - 1 && !editing && (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {screen === "done" && <Celebration onStart={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function Welcome({
  busy,
  onStart,
  onSkip,
}: {
  busy: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-1/10 text-4xl"
      >
        <span aria-hidden="true">👋</span>
      </motion.div>
      <DialogTitle className="mt-6 font-display text-2xl font-bold">
        Welcome to StudyAssistant!
      </DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-xs text-sm leading-relaxed">
        Let's personalize Aeva for you — a few quick questions, under a minute,
        every step skippable.
      </DialogDescription>
      <div className="mt-8 w-full space-y-2">
        <Button
          onClick={onStart}
          disabled={busy}
          className="h-12 w-full gap-2 rounded-xl bg-brand-gradient text-base text-white shadow-glow"
        >
          <Sparkles className="h-4 w-4" /> Continue
        </Button>
        <Button
          variant="ghost"
          onClick={onSkip}
          disabled={busy}
          className="h-11 w-full rounded-xl text-muted-foreground"
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}

/** Edit mode's landing: jump straight to any question, then save once. */
function Overview({
  draft,
  busy,
  onJump,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onJump: (idx: number) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pb-2 pt-6">
        <DialogTitle className="font-display text-xl font-bold">
          Your learning profile
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm">
          Tap any question to update it.
        </DialogDescription>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
        {STEPS.map((s, i) => {
          const value = stepValue(draft, s);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onJump(i)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/50 px-4 py-3 text-left"
            >
              <span className="text-2xl" aria-hidden="true">
                {s.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{s.title}</span>
                <span
                  className={cn(
                    "mt-0.5 block truncate text-xs",
                    value ? "text-muted-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {value || "Not set"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
      <div className="border-t border-border/40 px-5 py-3">
        <Button
          onClick={onSave}
          disabled={busy}
          className="h-12 w-full gap-2 rounded-xl bg-brand-gradient text-white shadow-glow"
        >
          <Sparkles className="h-4 w-4" />
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function Celebration({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-1/10 text-4xl"
      >
        <span aria-hidden="true">🎉</span>
      </motion.div>
      <DialogTitle className="mt-6 font-display text-2xl font-bold">
        You're all set!
      </DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-xs text-sm leading-relaxed">
        Aeva is now personalized for your learning style. You can update this
        anytime in Settings.
      </DialogDescription>
      <Button
        onClick={onStart}
        className="mt-8 h-12 w-full rounded-xl bg-brand-gradient text-base text-white shadow-glow"
      >
        Start Learning
      </Button>
    </div>
  );
}
