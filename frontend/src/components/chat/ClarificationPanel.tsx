import { useState } from "react";
import { HelpCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ClarificationAnswer, ClarificationData } from "@/types";

export function ClarificationPanel({
  data,
  busy,
  onSubmit,
}: {
  data: ClarificationData;
  busy?: boolean;
  onSubmit: (answer: ClarificationAnswer) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");

  const singleQuestion = data.questions.length === 1;

  const pickOption = (questionId: string, option: string) => {
    if (busy) return;
    // One question: tapping a chip is the whole answer — submit immediately.
    if (singleQuestion) {
      onSubmit({ action: "answer", answers: { [questionId]: option } });
      return;
    }
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const sendCustom = () => {
    const text = custom.trim();
    if (busy || !text) return;
    onSubmit({ action: "custom", custom_text: text });
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <HelpCircle className="h-4 w-4" />
        Quick question
      </div>
      <p className="mt-1.5 text-sm">{data.reason}</p>

      <div className="mt-3 space-y-3">
        {data.questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <label className="text-xs font-medium">{q.text}</label>
            {q.options && q.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={busy}
                    onClick={() => pickOption(q.id, opt)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
                      answers[q.id] === opt
                        ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                        : "border-border bg-background hover:border-amber-500/60 hover:bg-amber-500/10",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                value={answers[q.id] || ""}
                placeholder="Type your answer…"
                onChange={(e) =>
                  setAnswers((p) => ({ ...p, [q.id]: e.target.value }))
                }
                className="h-9"
              />
            )}
          </div>
        ))}

        {/* Always available: type your own answer instead of a chip. */}
        <div className="flex items-center gap-2">
          <Input
            value={custom}
            placeholder="Or type your own answer…"
            disabled={busy}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendCustom();
              }
            }}
            className="h-9"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !custom.trim()}
            onClick={sendCustom}
            className="shrink-0 gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* Single-option questions submit on chip tap; this covers free-text
            and multi-question answers. */}
        <Button
          size="sm"
          disabled={busy || Object.keys(answers).length === 0}
          onClick={() => onSubmit({ action: "answer", answers })}
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onSubmit({ action: "skip" })}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}
