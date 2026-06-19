import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClarificationData } from "@/types";

interface ClarificationPanelProps {
  data: ClarificationData;
  runId: string;
  onSubmit: (payload: {
    action: "answer" | "custom" | "skip";
    answers?: Record<string, string>;
    custom_text?: string;
  }) => void;
  disabled?: boolean;
}

export function ClarificationPanel({
  data,
  onSubmit,
  disabled,
}: ClarificationPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
        Clarification needed
      </p>
      <p className="text-sm">{data.reason}</p>
      {data.questions.map((q) => (
        <div key={q.id} className="space-y-1">
          <label className="text-xs font-medium">{q.text}</label>
          {q.options && q.options.length > 0 ? (
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={answers[q.id] || ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
              }
            >
              <option value="">Select...</option>
              {q.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={answers[q.id] || ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
              }
              className="text-sm"
            />
          )}
        </div>
      ))}
      {showCustom && (
        <Textarea
          placeholder="Type your own response..."
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          className="text-sm"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => onSubmit({ action: "answer", answers })}
        >
          Submit answers
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setShowCustom((v) => !v)}
        >
          Custom
        </Button>
        {showCustom && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || !customText.trim()}
            onClick={() =>
              onSubmit({ action: "custom", custom_text: customText })
            }
          >
            Send custom
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onSubmit({ action: "skip" })}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}
