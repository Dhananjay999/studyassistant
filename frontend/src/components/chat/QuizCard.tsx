import { ArrowRight, BarChart3, Clock, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import type { QuizContent } from "@/types";

const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export function QuizCard({
  quiz,
  onStart,
}: {
  quiz: QuizContent;
  onStart: () => void;
}) {
  const count = quiz.questions?.length ?? 0;
  const mins = Math.max(1, Math.round(count * 2));
  const source = quiz.source || quiz.topic;

  return (
    <GlassCard className="mt-3 max-w-md p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-display text-base font-bold leading-tight">
          {quiz.title}
        </h4>
        <Badge variant="secondary" className="shrink-0">
          Mixed Types
        </Badge>
      </div>
      {source && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          Based on “{source}”
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4" /> {count} Questions
        </span>
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4" /> ~{mins} mins
        </span>
        <span className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />{" "}
          {quiz.difficulty ? `${cap(quiz.difficulty)} difficulty` : "Mixed"}
        </span>
      </div>

      <Button onClick={onStart} className="mt-4 w-full gap-2">
        Start Quiz <ArrowRight className="h-4 w-4" />
      </Button>
    </GlassCard>
  );
}
