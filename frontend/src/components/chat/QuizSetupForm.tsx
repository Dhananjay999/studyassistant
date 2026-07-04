import { useState } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExamSettingsFields } from "@/components/quiz/ExamSettingsFields";
import { useAppConfig } from "@/hooks/api";
import { cn } from "@/lib/utils";
import { isExamConfig, NEUTRAL_EXAM_CONFIG } from "@/lib/quizFormat";
import type { Difficulty, ExamConfig, QuestionType, QuizOptions } from "@/types";

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multiple select" },
  { value: "true_false", label: "True / False" },
];
const ALL_TYPES: QuestionType[] = TYPE_OPTIONS.map((t) => t.value);
const DEFAULT_MAX = 25;

export function QuizSetupForm({
  initialTopic = "",
  initialCount,
  initialTypes,
  initialDifficulty,
  initialExamConfig,
  mediaAvailable = false,
  busy = false,
  onGenerate,
  className,
}: {
  initialTopic?: string;
  initialCount?: number | null;
  initialTypes?: QuestionType[] | null;
  initialDifficulty?: Difficulty | null;
  initialExamConfig?: ExamConfig | null;
  mediaAvailable?: boolean;
  busy?: boolean;
  onGenerate: (options: QuizOptions) => void;
  className?: string;
}) {
  const { data: config } = useAppConfig();
  const maxQuestions = config?.max_quiz_questions ?? DEFAULT_MAX;

  const [topic, setTopic] = useState(initialTopic);
  const [count, setCount] = useState(String(initialCount ?? 5));
  const [difficulty, setDifficulty] = useState<Difficulty>(
    initialDifficulty ?? "medium",
  );
  // Prefill detected types; default to Mixed (all) when none were specified.
  const [types, setTypes] = useState<QuestionType[]>(
    initialTypes && initialTypes.length > 0 ? initialTypes : ALL_TYPES,
  );
  const [instructions, setInstructions] = useState("");
  const [useMedia, setUseMedia] = useState(false);

  // Exam Mode: editable marking scheme + timer (see ExamSettingsFields).
  const [exam, setExam] = useState<ExamConfig>(
    initialExamConfig ?? NEUTRAL_EXAM_CONFIG,
  );

  const isMixed = ALL_TYPES.every((t) => types.includes(t));
  const countNum = Number(count);
  const countValid =
    Number.isInteger(countNum) && countNum >= 1 && countNum <= maxQuestions;

  const toggleType = (t: QuestionType) =>
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  const selectMixed = () => setTypes(ALL_TYPES);

  const submit = () => {
    if (!countValid || types.length === 0) return;
    onGenerate({
      topic: topic.trim() || undefined,
      question_count: countNum,
      difficulty,
      question_types: types,
      use_media: mediaAvailable ? useMedia : undefined,
      additional_instructions: instructions.trim() || undefined,
      exam_config: isExamConfig(exam) ? exam : undefined,
    });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <Label className="text-xs">Topic</Label>
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Photosynthesis"
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <div className="space-y-1.5">
          <Label className="text-xs">Difficulty</Label>
          <Select
            value={difficulty}
            onValueChange={(v) => setDifficulty(v as Difficulty)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
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

      <Button
        onClick={submit}
        disabled={busy || types.length === 0 || !countValid}
        className="w-full gap-2"
      >
        <Sparkles className="h-4 w-4" />
        {busy ? "Generating…" : "Generate quiz"}
      </Button>
    </div>
  );
}
