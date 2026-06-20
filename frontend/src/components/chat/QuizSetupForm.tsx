import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Difficulty, QuestionType, QuizOptions } from "@/types";

const TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single_select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" },
  { value: "true_false", label: "True / False" },
];

export function QuizSetupForm({
  initialTopic = "",
  mediaAvailable = false,
  busy = false,
  onGenerate,
  className,
}: {
  initialTopic?: string;
  mediaAvailable?: boolean;
  busy?: boolean;
  onGenerate: (options: QuizOptions) => void;
  className?: string;
}) {
  const [topic, setTopic] = useState(initialTopic);
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [types, setTypes] = useState<QuestionType[]>([
    "single_select",
    "multi_select",
    "true_false",
  ]);
  const [useMedia, setUseMedia] = useState(false);

  const toggleType = (t: QuestionType) =>
    setTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );

  const submit = () =>
    onGenerate({
      topic: topic.trim() || undefined,
      question_count: Number(count),
      difficulty,
      question_types: types,
      use_media: mediaAvailable ? useMedia : undefined,
    });

  return (
    <div className={cn("space-y-4", className)}>
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
          <Select value={count} onValueChange={setCount}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["3", "5", "8", "10"].map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <div className="flex flex-col gap-2">
          {TYPE_OPTIONS.map((t) => (
            <label
              key={t.value}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={types.includes(t.value)}
                onCheckedChange={() => toggleType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </div>
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

      <Button
        onClick={submit}
        disabled={busy || types.length === 0}
        className="w-full gap-2"
      >
        <Sparkles className="h-4 w-4" />
        {busy ? "Generating…" : "Generate quiz"}
      </Button>
    </div>
  );
}
