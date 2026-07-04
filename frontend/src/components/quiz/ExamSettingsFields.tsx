import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExamPatterns } from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { ExamConfig, ExamPattern, QuestionType } from "@/types";

const CUSTOM_KEY = "custom";
// Quick-pick timer values (minutes); the numeric field allows any value.
const TIMER_PRESETS = [15, 30, 60, 90, 180];

/**
 * The editable Exam Mode controls (pattern preset, timer, marking scheme),
 * shared by the quiz setup form and the "Edit settings" panel. Fully
 * controlled: the parent owns the ExamConfig. Picking a preset auto-fills the
 * scheme + timer; editing any marking field flips the pattern to "custom".
 * Negative and skip are penalty magnitudes (stored <= 0) so a positive can
 * never inflate a score.
 */
export function ExamSettingsFields({
  value,
  onChange,
  onPatternDefaultType,
}: {
  value: ExamConfig;
  onChange: (next: ExamConfig) => void;
  /** Fired when a preset suggests a question type (setup form seeds types). */
  onPatternDefaultType?: (type: QuestionType) => void;
}) {
  const { data: examPatterns = [] } = useExamPatterns();
  const timerMinutes = Math.round(value.timer_seconds / 60);

  const applyPattern = (key: string) => {
    if (key === CUSTOM_KEY) {
      onChange({ ...value, pattern: CUSTOM_KEY });
      return;
    }
    const preset = examPatterns.find((p: ExamPattern) => p.key === key);
    if (!preset) return;
    onChange({
      pattern: key,
      correct: preset.correct,
      negative: preset.negative,
      skip: preset.skip,
      timer_seconds: preset.timer_seconds,
    });
    if (preset.default_type) onPatternDefaultType?.(preset.default_type);
  };

  const editMark = (field: "correct" | "negative" | "skip", raw: string) => {
    const magnitude = raw === "" ? 0 : Math.abs(Number(raw));
    if (Number.isNaN(magnitude)) return;
    const next = field === "correct" ? magnitude : -magnitude;
    onChange({ ...value, pattern: CUSTOM_KEY, [field]: next });
  };

  const setTimerMinutes = (minutes: number) =>
    onChange({
      ...value,
      timer_seconds: Math.max(0, Math.round(minutes)) * 60,
    });

  return (
    <div className="space-y-2">
      {/* Pattern + timer on one row; marking on the next — compact. */}
      <div className="grid grid-cols-2 gap-2">
        <Select value={value.pattern} onValueChange={applyPattern}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Exam pattern" />
          </SelectTrigger>
          <SelectContent>
            {examPatterns.map((p: ExamPattern) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={timerMinutes || ""}
            onChange={(e) => setTimerMinutes(Number(e.target.value) || 0)}
            placeholder="0"
            aria-label="Timer in minutes"
            className="h-8 pr-10 text-xs"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            min
          </span>
        </div>
      </div>

      {/* Quick timer picks — one tight row. */}
      <div className="flex flex-wrap gap-1">
        <TimerChip
          active={value.timer_seconds === 0}
          onClick={() => setTimerMinutes(0)}
        >
          No timer
        </TimerChip>
        {TIMER_PRESETS.map((m) => (
          <TimerChip
            key={m}
            active={timerMinutes === m}
            onClick={() => setTimerMinutes(m)}
          >
            {m}m
          </TimerChip>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarkField
          label="Correct"
          value={value.correct}
          onChange={(v) => editMark("correct", v)}
        />
        <MarkField
          label="Negative"
          value={value.negative}
          penalty
          onChange={(v) => editMark("negative", v)}
        />
        <MarkField
          label="Skip"
          value={value.skip}
          penalty
          onChange={(v) => editMark("skip", v)}
        />
      </div>
    </div>
  );
}

function TimerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function MarkField({
  label,
  value,
  penalty = false,
  onChange,
}: {
  label: string;
  value: number;
  // Penalty fields (negative marks, skip) take a positive magnitude and show a
  // leading "−"; the stored value is always <= 0.
  penalty?: boolean;
  onChange: (raw: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="relative">
        {penalty && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            −
          </span>
        )}
        <Input
          type="number"
          inputMode="decimal"
          step="0.25"
          min={0}
          value={Math.abs(value) || 0}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-8 text-xs", penalty && "pl-5")}
        />
      </div>
    </div>
  );
}
