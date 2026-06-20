import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
        <HelpCircle className="h-4 w-4" />
        Quick question
      </div>
      <p className="mt-1.5 text-sm">{data.reason}</p>

      <div className="mt-3 space-y-3">
        {data.questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <label className="text-xs font-medium">{q.text}</label>
            {q.options && q.options.length > 0 ? (
              <Select
                value={answers[q.id] || ""}
                onValueChange={(v) =>
                  setAnswers((p) => ({ ...p, [q.id]: v }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {q.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={answers[q.id] || ""}
                onChange={(e) =>
                  setAnswers((p) => ({ ...p, [q.id]: e.target.value }))
                }
                className="h-9"
              />
            )}
          </div>
        ))}

        {showCustom && (
          <Textarea
            placeholder="Type your own answer…"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onSubmit({ action: "answer", answers })}
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setShowCustom((v) => !v)}
        >
          Custom
        </Button>
        {showCustom && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !custom.trim()}
            onClick={() => onSubmit({ action: "custom", custom_text: custom })}
          >
            Send
          </Button>
        )}
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
