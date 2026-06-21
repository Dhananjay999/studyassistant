import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Clock,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { BookmarkButton } from "@/components/BookmarkButton";
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
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="mt-3 max-w-md"
    >
      <GlassCard className="border-brand-1/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
            <Sparkles className="h-4 w-4 text-brand-1" />
            {quiz.title}
          </h4>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary">Quiz</Badge>
            <BookmarkButton
              item={{
                item_type: "quiz",
                item_ref: quiz.quiz_id,
                title: quiz.title,
                content: quiz.topic || quiz.title,
                metadata: {
                  quiz_id: quiz.quiz_id,
                  topic: quiz.topic,
                  difficulty: quiz.difficulty,
                  question_count: count,
                },
              }}
            />
          </div>
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

        <Button
          onClick={onStart}
          className="group mt-4 w-full gap-2 bg-brand-gradient text-white"
        >
          Open Quiz
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Button>
      </GlassCard>
    </motion.div>
  );
}
