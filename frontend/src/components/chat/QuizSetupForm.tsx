import { useEffect, useState } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ExamSettingsFields } from "@/components/quiz/ExamSettingsFields";
import { useAppConfig } from "@/hooks/api";
import { cn } from "@/lib/utils";
import {
  difficultyMeta,
  difficultyToLevel,
  isExamConfig,
  levelToDifficulty,
  NEUTRAL_EXAM_CONFIG,
} from "@/lib/quizFormat";
import type {
  Difficulty,
  ExamConfig,
  QuestionType,
  QuizOptions,
  QuizSetupDraft,
} from "@/types";

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multiple select" },
  { value: "true_false", label: "True / False" },
];
const DEFAULT_MAX = 25;

export function QuizSetupForm({
  initialTopic = "",
  initialCount,
  initialTypes,
  initialDifficulty,
  initialExamConfig,
  draft,
  onDraftChange,
  mediaAvailable = false,
  busy = false,
  onGenerate,
  className,
  layout = "default",
}: {
  initialTopic?: string;
  initialCount?: number | null;
  initialTypes?: QuestionType[] | null;
  initialDifficulty?: Difficulty | null;
  initialExamConfig?: ExamConfig | null;
  /** A previously-typed form snapshot; wins over `initial*` so closing and
   * reopening the setup popup restores the user's progress. */
  draft?: QuizSetupDraft | null;
  /** Reports every form change so the host can stash a draft. */
  onDraftChange?: (draft: QuizSetupDraft) => void;
  mediaAvailable?: boolean;
  busy?: boolean;
  onGenerate: (options: QuizOptions) => void;
  className?: string;
  /** "sheet" fills its container: fields scroll, Generate pins to the bottom as
   * a sticky footer (used inside the mobile bottom sheet). */
  layout?: "default" | "sheet";
}) {
  const { data: config } = useAppConfig();
  const maxQuestions = config?.max_quiz_questions ?? DEFAULT_MAX;

  const [topic, setTopic] = useState(draft?.topic ?? initialTopic);
  const [count, setCount] = useState(
    draft?.count ?? String(initialCount ?? 5),
  );
  // Difficulty is chosen on a 1–10 slider and mapped to a 5-band label.
  const [level, setLevel] = useState<number>(
    draft?.level ?? difficultyToLevel(initialDifficulty ?? "medium"),
  );
  const difficulty: Difficulty = levelToDifficulty(level);
  // Prefill detected types; otherwise leave empty so the LLM may generate a
  // mixed-type quiz unless the user explicitly picks a format.
  const [types, setTypes] = useState<QuestionType[]>(
    draft?.types ?? initialTypes ?? [],
  );
  const [instructions, setInstructions] = useState(draft?.instructions ?? "");
  const [useMedia, setUseMedia] = useState(draft?.useMedia ?? false);

  // Exam Mode: editable marking scheme + timer (see ExamSettingsFields).
  const [exam, setExam] = useState<ExamConfig>(
    draft?.exam ?? initialExamConfig ?? NEUTRAL_EXAM_CONFIG,
  );

  // Snapshot every change so closing the popup never loses progress.
  useEffect(() => {
    onDraftChange?.({
      topic,
      count,
      level,
      types,
      instructions,
      useMedia,
      exam,
    });
  }, [onDraftChange, topic, count, level, types, instructions, useMedia, exam]);

  // No selection = Mixed: the LLM freely mixes question formats.
  const isMixed = types.length === 0;
  const countNum = Number(count);
  const countValid =
    Number.isInteger(countNum) && countNum >= 1 && countNum <= maxQuestions;

  const toggleType = (t: QuestionType) =>
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  const selectMixed = () => setTypes([]);

  const submit = () => {
    if (!countValid) return;
    onGenerate({
      topic: topic.trim() || undefined,
      question_count: countNum,
      difficulty,
      question_types: types.length > 0 ? types : undefined,
      use_media: mediaAvailable ? useMedia : undefined,
      additional_instructions: instructions.trim() || undefined,
      exam_config: isExamConfig(exam) ? exam : undefined,
    });
  };

  const submitButton = (
    <Button
      onClick={submit}
      disabled={busy || !countValid}
      className="w-full gap-2"
    >
      <Sparkles className="h-4 w-4" />
      {busy ? "Generating…" : "Generate quiz"}
    </Button>
  );

  const fields = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Topic</Label>
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Photosynthesis"
          className="h-9"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Questions</Label>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxQuestions}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className={cn("h-9", !countValid && "border-destructive")}
        />
        <p
          className={cn(
            "text-[10px]",
            countValid ? "text-muted-foreground" : "text-destructive",
          )}
        >
          1–{maxQuestions} questions
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Difficulty</Label>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              difficultyMeta(difficulty).className,
            )}
          >
            {difficultyMeta(difficulty).label} · {level}/10
          </span>
        </div>
        <Slider
          value={[level]}
          onValueChange={([v]) => setLevel(v)}
          min={1}
          max={10}
          step={1}
          aria-label="Difficulty"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Beginner</span>
          <span>Expert</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Question types</Label>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => {
            const active = types.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleType(t.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={selectMixed}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isMixed
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            Mixed
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Pick specific formats, or leave it on Mixed to let the AI vary them.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Additional instructions</Label>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Optional instructions…"
          rows={2}
          className="resize-none text-sm"
        />
      </div>

      {mediaAvailable && (
        <div className="space-y-2">
          <Label className="text-xs">Source</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setUseMedia(false)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                !useMedia
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              This topic
            </button>
            <button
              type="button"
              onClick={() => setUseMedia(true)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                useMedia
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              Uploaded material
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-2.5">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <GraduationCap className="h-3.5 w-3.5 text-primary" />
            Exam settings
          </p>
          <span className="text-[10px] text-muted-foreground">
            per correct / wrong / skipped
          </span>
        </div>
        <ExamSettingsFields
          value={exam}
          onChange={setExam}
          onPatternDefaultType={(t) => setTypes([t])}
        />
      </div>
    </>
  );

  // Sheet layout: fields scroll inside a flex column and the primary action
  // pins to the bottom as a sticky, safe-area-padded footer.
  if (layout === "sheet") {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
        {/* `overscroll-contain` keeps the fields scrolling inside the sheet
           instead of the gesture bubbling up and drag-dismissing the drawer,
           which is what left the lower fields unreachable on some phones. */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-3 px-1">
          {fields}
        </div>
        <div className="-mx-4 border-t border-border/50 bg-background px-4 pt-3">
          {submitButton}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {fields}
      {submitButton}
    </div>
  );
}
