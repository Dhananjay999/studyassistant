import { useState } from "react";
import { toast } from "sonner";
import { GraduationCap, Loader2, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExamSettingsFields } from "@/components/quiz/ExamSettingsFields";
import { useExamPatterns, useUpdateExamConfig } from "@/hooks/api";
import {
  difficultyMeta,
  formatMark,
  formatTimeLimit,
} from "@/lib/quizFormat";
import { hasExamConfig, type ExamConfig, type QuizContent } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multiple select",
  true_false: "True / False",
};

/** Distinct question types present in the quiz, as a readable label. */
function questionTypeLabel(quiz: QuizContent): string {
  const kinds = [...new Set((quiz.questions ?? []).map((q) => q.type))];
  if (kinds.length === 0) return "—";
  if (kinds.length > 1) return "Mixed";
  return TYPE_LABELS[kinds[0]] ?? kinds[0];
}

/**
 * Pre-attempt exam briefing. Shown before a timed exam-mode quiz so students
 * confirm the pattern, timer, and marking scheme (a real-exam instruction
 * screen) before the countdown starts. "Edit settings" opens an inline editor
 * that persists the new scheme to the quiz (reused by every future attempt).
 */
export function ExamSummary({
  quiz,
  onStart,
  onConfigSaved,
}: {
  quiz: QuizContent;
  onStart: () => void;
  /** Called after settings are saved so the drawer uses the new config. */
  onConfigSaved?: (config: ExamConfig) => void;
}) {
  const { data: patterns = [] } = useExamPatterns();
  const updateConfig = useUpdateExamConfig();
  const [draft, setDraft] = useState<ExamConfig | null>(null);

  if (!hasExamConfig(quiz.exam_config)) return null;
  const cfg = quiz.exam_config;

  const save = async () => {
    if (!draft) return;
    try {
      const res = await updateConfig.mutateAsync({
        id: quiz.quiz_id,
        examConfig: draft,
      });
      onConfigSaved?.(res.exam_config);
      setDraft(null);
      toast.success("Exam settings updated");
    } catch {
      toast.error("Couldn't update the settings. Please try again.");
    }
  };

  // Edit mode — an inline settings editor with Save / Cancel.
  if (draft) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
        <div className="mx-auto w-full max-w-md space-y-3">
          <p className="flex items-center gap-1.5 font-display text-sm font-semibold">
            <Pencil className="h-4 w-4 text-primary" /> Edit exam settings
          </p>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <ExamSettingsFields value={draft} onChange={setDraft} />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={save}
              disabled={updateConfig.isPending}
              className="flex-1 gap-1.5 bg-brand-gradient text-white"
            >
              {updateConfig.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save settings
            </Button>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const patternLabel =
    patterns.find((p) => p.key === cfg.pattern)?.label ??
    (cfg.pattern === "custom" ? "Custom" : cfg.pattern);
  const diff = difficultyMeta(quiz.difficulty);
  const total = quiz.questions?.length ?? 0;

  const rows: { label: string; value: string }[] = [
    { label: "Topic", value: quiz.topic || quiz.title },
    { label: "Exam pattern", value: patternLabel },
    { label: "Total questions", value: String(total) },
    { label: "Question type", value: questionTypeLabel(quiz) },
    { label: "Difficulty", value: diff.label },
    {
      label: "Time limit",
      value: cfg.timer_seconds > 0 ? formatTimeLimit(cfg.timer_seconds) : "None",
    },
    { label: "Correct answer", value: formatMark(cfg.correct) },
    {
      label: "Negative marks",
      value: cfg.negative === 0 ? "0" : formatMark(cfg.negative),
    },
    { label: "Skipped answer", value: formatMark(cfg.skip) },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6">
      <div className="mx-auto w-full max-w-md">
        <div className="grid place-items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <GraduationCap className="h-6 w-6" />
          </div>
          <h3 className="mt-4 font-display text-xl font-bold">
            {patternLabel} · Exam mode
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the setup below, then start when you're ready. The timer
            begins as soon as you start.
          </p>
        </div>

        <dl className="mt-6 divide-y divide-border/60 rounded-xl border border-border/60">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
            >
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="text-right font-medium">{r.value}</dd>
            </div>
          ))}
        </dl>

        <Button
          onClick={onStart}
          className="mt-5 w-full gap-2 bg-brand-gradient text-white"
        >
          <Play className="h-4 w-4" /> Start Quiz
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDraft(cfg)}
          className="mt-2 w-full gap-1.5 text-muted-foreground"
        >
          <Pencil className="h-4 w-4" /> Edit settings
        </Button>
      </div>
    </div>
  );
}
