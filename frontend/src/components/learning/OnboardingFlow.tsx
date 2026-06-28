import { useState, type ReactNode } from "react";
import { GraduationCap, PartyPopper, Sparkles } from "lucide-react";
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
  useSaveLearningProfile,
  useSkipPersonalization,
} from "@/hooks/api";
import {
  EDUCATION_LEVELS,
  EXPLANATION_STYLES,
  FAVORITE_SUBJECTS,
  LEARNING_GOALS,
  PREFERRED_LANGUAGES,
} from "@/lib/learningProfile";

const OTHER = "Other";
const TOTAL_STEPS = 5;

/**
 * Optional personalization onboarding. A welcome screen, five skippable steps
 * with a progress bar, and a completion screen. Closing the dialog at any point
 * is treated as "skip for now" — the user is never blocked.
 */
export function OnboardingFlow({
  open,
  onDone,
}: {
  open: boolean;
  /** Called after the user completes or skips; parent should dismiss + refresh. */
  onDone: () => void;
}) {
  // 0 = welcome, 1..5 = questions, 6 = completion.
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState("");
  const [otherLevel, setOtherLevel] = useState("");
  const [language, setLanguage] = useState("");
  const [style, setStyle] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [goal, setGoal] = useState("");

  const saveMutation = useSaveLearningProfile();
  const skipMutation = useSkipPersonalization();
  const busy = saveMutation.isPending || skipMutation.isPending;

  const single = (current: string, value: string, set: (v: string) => void) =>
    set(current === value ? "" : value);

  const toggleSubject = (subject: string) =>
    setSubjects((prev) =>
      prev.includes(subject)
        ? prev.filter((s) => s !== subject)
        : [...prev, subject],
    );

  const handleSkip = async () => {
    try {
      await skipMutation.mutateAsync();
    } finally {
      onDone();
    }
  };

  const handleFinish = async () => {
    const resolvedLevel = level === OTHER ? otherLevel.trim() : level;
    try {
      await saveMutation.mutateAsync({
        education_level: resolvedLevel || null,
        preferred_language: language || null,
        explanation_style: style || null,
        favorite_subjects: subjects,
        learning_goal: goal || null,
      });
      setStep(TOTAL_STEPS + 1);
    } catch {
      /* surfaced via mutation state; keep the user on the step */
    }
  };

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(1, s - 1));

  // Closing via X / Escape / overlay counts as "skip for now".
  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !busy) void handleSkip();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {step === 0 && (
          <WelcomeStep busy={busy} onStart={next} onSkip={handleSkip} />
        )}

        {step >= 1 && step <= TOTAL_STEPS && (
          <div className="flex flex-col">
            <div className="border-b border-border/50 px-6 pb-4 pt-6">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>
                  Step {step} of {TOTAL_STEPS}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={step === TOTAL_STEPS ? handleFinish : next}
                  disabled={busy}
                >
                  Skip this step
                </button>
              </div>
              <Progress value={(step / TOTAL_STEPS) * 100} className="h-1.5" />
            </div>

            <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
              {step === 1 && (
                <Field
                  title="What are you currently studying?"
                  hint="This is the most useful detail for tailoring answers."
                >
                  <ChipSelect
                    options={[...EDUCATION_LEVELS, OTHER]}
                    selected={[level]}
                    onToggle={(o) => single(level, o, setLevel)}
                  />
                  {level === OTHER && (
                    <Input
                      autoFocus
                      value={otherLevel}
                      onChange={(e) => setOtherLevel(e.target.value)}
                      placeholder="Tell us what you're studying"
                      className="mt-3"
                    />
                  )}
                </Field>
              )}

              {step === 2 && (
                <Field title="How would you like Aeva to explain concepts?">
                  <ChipSelect
                    options={PREFERRED_LANGUAGES}
                    selected={[language]}
                    onToggle={(o) => single(language, o, setLanguage)}
                  />
                </Field>
              )}

              {step === 3 && (
                <Field title="Preferred explanation style">
                  <ChipSelect
                    options={EXPLANATION_STYLES}
                    selected={[style]}
                    onToggle={(o) => single(style, o, setStyle)}
                  />
                </Field>
              )}

              {step === 4 && (
                <Field
                  title="Favorite subjects"
                  hint="Pick as many as you like."
                >
                  <ChipSelect
                    options={FAVORITE_SUBJECTS}
                    selected={subjects}
                    onToggle={toggleSubject}
                  />
                </Field>
              )}

              {step === 5 && (
                <Field title="What are you preparing for?">
                  <ChipSelect
                    options={LEARNING_GOALS}
                    selected={[goal]}
                    onToggle={(o) => single(goal, o, setGoal)}
                  />
                </Field>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border/50 px-6 py-4">
              <Button
                variant="ghost"
                onClick={back}
                disabled={busy || step === 1}
              >
                Back
              </Button>
              {step < TOTAL_STEPS ? (
                <Button onClick={next} disabled={busy}>
                  Continue
                </Button>
              ) : (
                <Button onClick={handleFinish} disabled={busy} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  {busy ? "Saving…" : "Finish"}
                </Button>
              )}
            </div>
          </div>
        )}

        {step === TOTAL_STEPS + 1 && (
          <CompletionStep onStart={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function WelcomeStep({
  busy,
  onStart,
  onSkip,
}: {
  busy: boolean;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-1/10 text-brand-1">
        <GraduationCap className="h-7 w-7" />
      </div>
      <DialogTitle className="text-xl font-bold">
        Welcome to StudyAssistant 👋
      </DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-sm text-sm">
        Help Aeva understand how you learn so responses can be tailored to you.
        This takes less than a minute.
      </DialogDescription>
      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" onClick={onStart} disabled={busy} className="gap-2">
          <Sparkles className="h-4 w-4" />
          Personalize My Experience
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          Skip for Now
        </Button>
      </div>
    </div>
  );
}

function CompletionStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="px-6 py-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-1/10 text-brand-1">
        <PartyPopper className="h-7 w-7" />
      </div>
      <DialogTitle className="text-xl font-bold">You're all set! 🎉</DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-sm text-sm">
        Aeva will now personalize explanations based on your learning profile.
        You can update it anytime in Settings.
      </DialogDescription>
      <div className="mt-6">
        <Button size="lg" onClick={onStart} className="w-full">
          Start Learning
        </Button>
      </div>
    </div>
  );
}
