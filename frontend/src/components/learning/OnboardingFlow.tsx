import { useEffect, useRef, useState, type FocusEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Sparkles, Target } from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import {
  useLearningProfile,
  useSaveLearningProfile,
  useSkipPersonalization,
} from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { useSwipe } from "@/hooks/useSwipe";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind } from "@/lib/errorMessage";
import {
  CUSTOM_MAX,
  EMPTY_ANSWERS,
  EXAM_PREP_GOAL_ID,
  FOCUS_CUSTOM_MAX,
  OTHER_ID,
  OTHER_LABEL,
  STEPS,
  answerText,
  branchOf,
  canContinue,
  carryOverPreferences,
  copyFor,
  fromProfile,
  isExamPrepGoal,
  isUnanswered,
  isVisible,
  optionsFor,
  personalizationSummary,
  setCustom,
  setSingle,
  stepById,
  toProfileInput,
  toggleFocus,
  visibleSteps,
  type Answers,
  type MultiStep,
  type SingleStep,
  type StepDef,
  type StepId,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/** Beat between tapping a single-select option and auto-advancing. */
const ADVANCE_MS = 260;
const DRAFT_PREFIX = "aeva.onboarding.draft.v1:";

interface Draft {
  answers: Answers;
  stepId: StepId;
}

/** Saved mid-flow progress (survives refresh); null when absent/invalid. */
function loadDraft(key: string | null): Draft | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    const a = d?.answers;
    if (
      !a ||
      typeof a.single !== "object" ||
      typeof a.custom !== "object" ||
      !Array.isArray(a.focus) ||
      !visibleSteps(a).some((s) => s.id === d.stepId)
    ) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function saveDraft(key: string | null, draft: Draft | null): void {
  if (!key) return;
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode, blocked): resume just won't work.
  }
}

/**
 * Personalization as a short conversation: one question per screen, where
 * earlier answers decide which questions come next (see `lib/onboarding.ts`
 * for the flow definition). Back keeps answers; changing one clears what no
 * longer applies.
 *
 * - First run (`mode="onboarding"`): welcome → questions → celebration.
 *   Every step is skippable and progress is saved locally so a refresh
 *   resumes.
 * - Settings (`mode="edit"`): opens on an overview prefilled from the saved
 *   profile; tap any question to change it. If a change brings up new
 *   questions (e.g. School → College), those follow before returning to the
 *   overview. Nothing is written until "Save changes".
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
  const { user } = useAuth();
  // Edit mode never persists a draft: closing it simply discards changes.
  const draftKey = user && !editing ? `${DRAFT_PREFIX}${user.id}` : null;

  const [screen, setScreen] = useState<"intro" | "question" | "done">("intro");
  const [stepId, setStepIdState] = useState<StepId>("context");
  const [dir, setDir] = useState(1);
  const [answers, setAnswersState] = useState<Answers>(EMPTY_ANSWERS);
  const [saveError, setSaveError] = useState(false);

  // Refs mirror state so the delayed auto-advance never reads stale values.
  const answersRef = useRef(answers);
  const stepRef = useRef(stepId);
  const advanceTimer = useRef<number>();
  // Option id the current step had when it was entered (change analytics).
  const enteredWith = useRef<string | undefined>();
  // Edit mode: questions a change made newly visible or cleared, visited
  // next before returning to the overview.
  const pending = useRef(new Set<StepId>());

  const { data: profile } = useLearningProfile();
  // Exam Prep (default-off flag): offers the "Exam Preparation" goal and a
  // "Set up my exam plan" hand-off on the celebration screen.
  const examPrepEnabled = useFeature("exam_prep", false);
  const saveMutation = useSaveLearningProfile();
  const skipMutation = useSkipPersonalization();
  const busy = saveMutation.isPending || skipMutation.isPending;

  const setAnswers = (next: Answers) => {
    answersRef.current = next;
    setAnswersState(next);
  };

  const cancelAdvance = () => window.clearTimeout(advanceTimer.current);
  useEffect(() => cancelAdvance, []);

  const enter = (id: StepId, direction: number) => {
    cancelAdvance();
    setDir(direction);
    stepRef.current = id;
    setStepIdState(id);
    setScreen("question");
    setSaveError(false);
  };

  // Edit: prefill from the saved profile. First run: resume a saved draft,
  // else start on the welcome screen.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      pending.current.clear();
      setAnswers(fromProfile(profile));
      setSaveError(false);
      setScreen("intro");
      analytics.track(AnalyticsEvent.ONBOARDING_STARTED, { mode: "edit" });
      return;
    }
    const draft = loadDraft(draftKey);
    if (draft) {
      setAnswers(draft.answers);
      enter(draft.stepId, 1);
      analytics.track(AnalyticsEvent.ONBOARDING_STARTED, {
        mode: "first_run",
        resumed: true,
      });
    } else {
      setScreen("intro");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftKey, editing]);

  // Persist progress while answering.
  useEffect(() => {
    if (open && screen === "question") saveDraft(draftKey, { answers, stepId });
  }, [open, screen, answers, stepId, draftKey]);

  const step = stepById(stepId);
  const visible = visibleSteps(answers);
  const index = Math.max(0, visible.findIndex((s) => s.id === stepId));
  const isLast = !editing && index === visible.length - 1;
  const pendingAhead =
    editing && visible.slice(index + 1).some((s) => pending.current.has(s.id));

  useEffect(() => {
    if (!open || screen !== "question") return;
    const a = answersRef.current;
    const s = stepById(stepId);
    enteredWith.current = s.kind === "single" ? a.single[s.id] : undefined;
    if (editing) return;
    const steps = visibleSteps(a);
    analytics.track(AnalyticsEvent.ONBOARDING_STEP_VIEWED, {
      step: stepId,
      step_index: steps.findIndex((x) => x.id === stepId),
      branch: branchOf(a),
      visible_total: steps.length,
    });
  }, [open, screen, stepId, editing]);

  // True while the final save is in flight. The last step stays tappable
  // for the seconds the save takes, and a second tap must not save (and
  // report completion) again.
  const finishing = useRef(false);

  const finish = async (a: Answers) => {
    if (finishing.current) return;
    finishing.current = true;
    setSaveError(false);
    try {
      await saveMutation.mutateAsync(toProfileInput(a, profile));
    } catch (err) {
      analytics.track(AnalyticsEvent.ONBOARDING_SAVE_FAILED, {
        error_kind: errorKind(err),
      });
      setSaveError(true);
      return;
    } finally {
      finishing.current = false;
    }
    const steps = visibleSteps(a);
    analytics.track(AnalyticsEvent.ONBOARDING_COMPLETED, {
      steps_answered: steps.filter((s) => !isUnanswered(s, a)).length,
      has_exam_target: !!a.single.exam,
      subject_count: a.focus.length,
      branch: branchOf(a),
      steps_visible: steps.length,
      has_custom_language: a.single.language === OTHER_ID,
    });
    saveDraft(draftKey, null);
    setScreen("done");
  };

  const saveEdits = async () => {
    setSaveError(false);
    const a = answersRef.current;
    try {
      await saveMutation.mutateAsync(toProfileInput(a, profile));
    } catch (err) {
      analytics.track(AnalyticsEvent.ONBOARDING_SAVE_FAILED, {
        error_kind: errorKind(err),
      });
      setSaveError(true);
      return;
    }
    analytics.track(AnalyticsEvent.LEARNING_PROFILE_SAVED, {
      fields_set: visibleSteps(a).filter((s) => !isUnanswered(s, a)).length,
    });
    onDone();
  };

  /** Advance from the current step; `skipping` bypasses required-answer validation. */
  const goNext = (skipping = false) => {
    cancelAdvance();
    if (finishing.current) return;
    const a = answersRef.current;
    const s = stepById(stepRef.current);
    if (!skipping && !canContinue(s, a)) return;
    const steps = visibleSteps(a);
    const i = steps.findIndex((x) => x.id === s.id);
    const selected = s.kind === "single" ? a.single[s.id] : undefined;
    analytics.track(AnalyticsEvent.ONBOARDING_STEP_COMPLETED, {
      step: s.id,
      step_index: i,
      skipped: isUnanswered(s, a),
      selection_count: s.kind === "multi" ? a.focus.length : undefined,
      branch: branchOf(a),
      selected_id: selected,
      previous_id:
        enteredWith.current && enteredWith.current !== selected
          ? enteredWith.current
          : undefined,
      changed: !!enteredWith.current && enteredWith.current !== selected,
      has_custom_value:
        s.kind === "multi"
          ? a.focus.some(
              (f) => !optionsFor(s, a).some((o) => o.label === f),
            )
          : selected === OTHER_ID,
    });
    if (editing) {
      pending.current.delete(s.id);
      const next = steps.slice(i + 1).find((x) => pending.current.has(x.id));
      if (next) enter(next.id, 1);
      else setScreen("intro");
      return;
    }
    if (i < steps.length - 1) enter(steps[i + 1].id, 1);
    else void finish(a);
  };

  /** Skip = leave this question unanswered and move on. */
  const skipStep = () => {
    const a = answersRef.current;
    const s = stepById(stepRef.current);
    setAnswers(
      s.kind === "multi"
        ? { ...a, focus: [] }
        : setSingle(a, s.id, ""),
    );
    goNext(true);
  };

  const back = () => {
    cancelAdvance();
    if (editing) {
      setScreen("intro");
      return;
    }
    const a = answersRef.current;
    const steps = visibleSteps(a);
    const i = steps.findIndex((x) => x.id === stepRef.current);
    analytics.track(AnalyticsEvent.ONBOARDING_BACK, {
      step: stepRef.current,
      step_index: i,
      branch: branchOf(a),
    });
    if (i > 0) enter(steps[i - 1].id, -1);
    else setScreen("intro");
  };

  /** Set answers; in edit mode, queue questions the change brought up. */
  const applyChange = (prev: Answers, next: Answers) => {
    if (editing) {
      for (const s of visibleSteps(next)) {
        const fresh = !isVisible(s, prev) || !isUnanswered(s, prev);
        if (isUnanswered(s, next) && fresh) pending.current.add(s.id);
      }
    }
    setAnswers(next);
  };

  // Single-select: choosing an option advances after a short beat, so the
  // flow reads as a conversation rather than select-then-submit.
  const pick = (s: SingleStep, id: string) => {
    const a = answersRef.current;
    const current = a.single[s.id];
    if (current === id) {
      if (id !== OTHER_ID) applyChange(a, setSingle(a, s.id, ""));
      return;
    }
    applyChange(a, setSingle(a, s.id, id));
    cancelAdvance();
    if (id !== OTHER_ID) {
      advanceTimer.current = window.setTimeout(() => goNext(), ADVANCE_MS);
    }
  };

  const handleSkipAll = async (via: "button" | "dismiss") => {
    cancelAdvance();
    analytics.track(AnalyticsEvent.ONBOARDING_SKIPPED, {
      at_step_index: screen === "question" ? index : -1,
      via,
    });
    saveDraft(draftKey, null);
    try {
      await skipMutation.mutateAsync();
    } finally {
      onDone();
    }
  };

  const swipe = useSwipe({
    onSwipeLeft: () => screen === "question" && canContinue(step, answers) && goNext(),
    onSwipeRight: () => screen === "question" && back(),
  });

  // Closing via X / Escape / overlay: "skip for now" on first run — except
  // after a successful save (never downgrade to skipped) or while editing,
  // where it simply closes and discards changes.
  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen || busy) return;
    if (editing || screen === "done") onDone();
    else void handleSkipAll("dismiss");
  };

  const progress = ((index + 1) / Math.max(visible.length, 1)) * 100;
  const progressLabel =
    visible.length - index <= 2 ? "Almost there" : "Getting to know you";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 pt-safe pb-safe max-sm:top-0 max-sm:h-[var(--app-height,100dvh)] max-sm:translate-y-0 sm:h-auto sm:min-h-[560px] sm:w-full sm:max-w-md sm:rounded-3xl sm:border">
        {screen === "intro" && editing && (
          <Overview
            answers={answers}
            busy={busy}
            saveError={saveError}
            onJump={(id) => enter(id, 1)}
            onSave={() => void saveEdits()}
          />
        )}

        {screen === "intro" && !editing && (
          <Welcome
            busy={busy}
            onStart={() => {
              analytics.track(AnalyticsEvent.ONBOARDING_STARTED, {
                mode: "first_run",
              });
              // Fresh start: carry over preferences saved elsewhere (e.g. a
              // "talk in Hinglish" chat request). Returning here via Back
              // keeps the answers already given.
              if (!answersRef.current.single.context) {
                setAnswers(carryOverPreferences(profile));
              }
              enter(STEPS[0].id, 1);
            }}
            onSkip={() => void handleSkipAll("button")}
          />
        )}

        {screen === "question" && (
          <div className="flex min-h-0 flex-1 flex-col" {...swipe}>
            {/* Progress header (pr-12 clears the dialog's close button) */}
            {editing ? (
              <div className="px-5 pb-3 pr-12 pt-5 text-xs font-medium text-muted-foreground">
                Your learning profile
              </div>
            ) : (
              <div className="px-5 pb-3 pr-12 pt-5">
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>{progressLabel}</span>
                  <button
                    type="button"
                    className="touch-target px-2 text-muted-foreground/80 hover:text-muted-foreground"
                    onClick={skipStep}
                    disabled={busy}
                  >
                    Skip
                  </button>
                </div>
                <Progress
                  value={progress}
                  className="h-1.5 [&>div]:transition-all [&>div]:duration-500"
                />
              </div>
            )}

            {/* Question */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
              <AnimatePresence mode="wait" custom={dir}>
                <motion.div
                  key={stepId}
                  initial={{ opacity: 0, x: dir * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * -40 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <Question
                    step={step}
                    answers={answers}
                    examPrepEnabled={examPrepEnabled}
                    onPick={pick}
                    onCustom={(s, text) =>
                      setAnswers(setCustom(answersRef.current, s.id, text))
                    }
                    onToggleFocus={(label) =>
                      setAnswers(toggleFocus(answersRef.current, label))
                    }
                    onSubmit={() => canContinue(step, answersRef.current) && goNext()}
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {saveError && (
              <p role="alert" className="px-5 pb-2 text-sm text-destructive">
                Couldn't save your answers. Check your connection and try again.
              </p>
            )}

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
                onClick={() => goNext()}
                disabled={busy || !canContinue(step, answers)}
                className={cn(
                  "h-11 flex-1 gap-1 rounded-xl sm:flex-none sm:px-8",
                  isLast ? "bg-brand-gradient text-white shadow-glow" : "",
                )}
              >
                {busy
                  ? "Saving…"
                  : editing
                    ? pendingAhead
                      ? "Next"
                      : "Done"
                    : isLast
                      ? saveError
                        ? "Try again"
                        : "Finish"
                      : "Next"}
                {!busy && (pendingAhead || (!editing && !isLast)) && (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        {screen === "done" && (
          <Celebration
            summary={personalizationSummary(answers)}
            examPrep={examPrepEnabled && isExamPrepGoal(answers)}
            onStart={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Keep a focused custom input above the on-screen keyboard. */
const revealOnFocus = (e: FocusEvent<HTMLInputElement>) => {
  const el = e.currentTarget;
  window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
};

function Question({
  step,
  answers,
  examPrepEnabled = false,
  onPick,
  onCustom,
  onToggleFocus,
  onSubmit,
}: {
  step: StepDef;
  answers: Answers;
  /** Shows the Exam Prep goal option (hidden while the flag is off). */
  examPrepEnabled?: boolean;
  onPick: (step: SingleStep, id: string) => void;
  onCustom: (step: SingleStep, text: string) => void;
  onToggleFocus: (label: string) => void;
  onSubmit: () => void;
}) {
  const copy = copyFor(step, answers);
  return (
    <>
      <div className="mb-1 text-4xl" aria-hidden="true">
        {copy.emoji}
      </div>
      <DialogTitle className="mt-2 font-display text-xl font-bold">
        {copy.title}
      </DialogTitle>
      {copy.hint && (
        <DialogDescription className="mt-1 text-sm">{copy.hint}</DialogDescription>
      )}
      <div className="mt-5">
        {step.kind === "single" ? (
          <SingleOptions
            step={step}
            answers={answers}
            examPrepEnabled={examPrepEnabled}
            onPick={onPick}
            onCustom={onCustom}
            onSubmit={onSubmit}
          />
        ) : (
          <FocusOptions step={step} answers={answers} onToggle={onToggleFocus} />
        )}
      </div>
      {step.footnote && (
        <p className="mt-4 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {step.footnote}
        </p>
      )}
    </>
  );
}

function SingleOptions({
  step,
  answers,
  examPrepEnabled = false,
  onPick,
  onCustom,
  onSubmit,
}: {
  step: SingleStep;
  answers: Answers;
  examPrepEnabled?: boolean;
  onPick: (step: SingleStep, id: string) => void;
  onCustom: (step: SingleStep, text: string) => void;
  onSubmit: () => void;
}) {
  // The Exam Prep goal lives in every goal list (so saved labels resolve) but
  // is offered only while the flag is on: flag-off users see today's lists.
  const options = [
    ...optionsFor(step, answers).filter(
      (o) => examPrepEnabled || o.id !== EXAM_PREP_GOAL_ID,
    ),
    ...(step.other ? [{ id: OTHER_ID, label: OTHER_LABEL }] : []),
  ];
  const value = answers.single[step.id];
  const custom = answers.custom[step.id] ?? "";
  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(step, option.id)}
            className={cn(
              "flex min-h-12 items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors",
              active
                ? "border-brand-1 bg-brand-1/10 text-brand-1"
                : "border-border/70 bg-card/50",
            )}
          >
            {option.label}
            {active && <Sparkles className="h-4 w-4 shrink-0" />}
          </button>
        );
      })}
      {step.other && value === OTHER_ID && (
        <div className="mt-1">
          <Input
            autoFocus
            value={custom}
            maxLength={CUSTOM_MAX}
            onChange={(e) => onCustom(step, e.target.value)}
            onFocus={revealOnFocus}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder={step.other.placeholder}
            enterKeyHint="next"
            className="h-12 rounded-xl"
          />
          <p className="mt-1.5 px-1 text-xs text-muted-foreground">
            {step.other.examples ??
              (custom.trim() ? "" : "Add a few words to continue, or tap Skip.")}
          </p>
        </div>
      )}
    </div>
  );
}

function FocusOptions({
  step,
  answers,
  onToggle,
}: {
  step: MultiStep;
  answers: Answers;
  onToggle: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [limitHit, setLimitHit] = useState(false);

  const labels = optionsFor(step, answers).map((o) => o.label);
  // User-added topics render as chips alongside the curated ones.
  const custom = answers.focus.filter((f) => !labels.includes(f));
  const full = answers.focus.length >= step.max;

  const toggle = (label: string) => {
    const selected = answers.focus.includes(label);
    setLimitHit(!selected && full);
    onToggle(label);
  };

  const add = () => {
    const label = text.trim();
    if (!label) return;
    const existing = [...labels, ...answers.focus].find(
      (l) => l.toLowerCase() === label.toLowerCase(),
    );
    if (!existing || !answers.focus.includes(existing)) toggle(existing ?? label);
    setText("");
    setAdding(false);
  };

  return (
    <div>
      <ChipSelect
        options={[...labels, ...custom]}
        selected={answers.focus}
        onToggle={toggle}
        className="gap-2.5 [&>button]:px-4 [&>button]:py-2.5"
      />
      <div className="mt-3">
        {adding ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={text}
              maxLength={FOCUS_CUSTOM_MAX}
              onChange={(e) => setText(e.target.value)}
              onFocus={revealOnFocus}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={step.addOwnPlaceholder}
              enterKeyHint="done"
              className="h-11 rounded-xl"
            />
            <Button
              type="button"
              onClick={add}
              disabled={!text.trim() || full}
              className="h-11 rounded-xl"
            >
              Add
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={full}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-border px-4 text-sm font-medium text-muted-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add your own
          </button>
        )}
      </div>
      <p
        className={cn(
          "mt-3 text-xs",
          limitHit ? "text-brand-1" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {limitHit
          ? `You can pick up to ${step.max} — deselect one to choose another.`
          : `${answers.focus.length}/${step.max} selected`}
      </p>
    </div>
  );
}

/** Edit mode's landing: every question on the current branch, tap to change. */
function Overview({
  answers,
  busy,
  saveError,
  onJump,
  onSave,
}: {
  answers: Answers;
  busy: boolean;
  saveError: boolean;
  onJump: (id: StepId) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pb-2 pr-12 pt-6">
        <DialogTitle className="font-display text-xl font-bold">
          Your learning profile
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm">
          Tap any question to update it.
        </DialogDescription>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 py-3">
        {visibleSteps(answers).map((s) => {
          const value = answerText(s, answers);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onJump(s.id)}
              className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/50 px-4 py-3 text-left"
            >
              <span className="text-2xl" aria-hidden="true">
                {copyFor(s, answers).emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{s.label}</span>
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
      {saveError && (
        <p role="alert" className="px-5 pb-2 text-sm text-destructive">
          Couldn't save your changes. Check your connection and try again.
        </p>
      )}
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
        Let Aeva get to know how you learn — a few quick taps, under a minute,
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

function Celebration({
  summary,
  examPrep = false,
  onStart,
}: {
  summary: string | null;
  /** Exam Prep goal chosen with the flag on: offer the plan setup. */
  examPrep?: boolean;
  onStart: () => void;
}) {
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
        {summary ?? "Aeva is now personalized for your learning style."} You can
        update this anytime in Settings.
      </DialogDescription>
      {examPrep ? (
        <ExamPrepCelebrationActions onDone={onStart} />
      ) : (
        <Button
          onClick={onStart}
          className="mt-8 h-12 w-full rounded-xl bg-brand-gradient text-base text-white shadow-glow"
        >
          Start Learning
        </Button>
      )}
    </div>
  );
}

/**
 * Hand-off from the first-run celebration into Exam Prep setup. Its own
 * component because it needs the router: the first-run flow always renders
 * inside it (ChatPage), while edit mode (Settings) may not — and edit mode
 * never reaches the celebration screen.
 */
function ExamPrepCelebrationActions({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const setUp = () => {
    analytics.track(AnalyticsEvent.EXAM_PREP_CTA_CLICKED, {
      source: "onboarding",
      has_plan: false,
    });
    onDone();
    navigate("/exam/setup");
  };
  return (
    <div className="mt-8 w-full space-y-2">
      <Button
        onClick={setUp}
        data-analytics-name="Set up my exam plan"
        className="h-12 w-full gap-2 rounded-xl bg-brand-gradient text-base text-white shadow-glow"
      >
        <Target className="h-4 w-4" /> Set up my exam plan
      </Button>
      <Button
        variant="ghost"
        onClick={onDone}
        className="h-11 w-full rounded-xl text-muted-foreground"
      >
        Maybe later
      </Button>
    </div>
  );
}
