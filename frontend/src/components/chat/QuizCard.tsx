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

// Positions for the one-shot celebratory sparkle burst.
const BURST = [
  { x: -26, y: -20, delay: 0.05 },
  { x: 28, y: -16, delay: 0.12 },
  { x: -18, y: 18, delay: 0.18 },
  { x: 22, y: 22, delay: 0.24 },
];

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
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      whileHover={{ scale: 1.02, y: -2 }}
      className="relative mt-3 max-w-md"
    >
      {/* one-shot sparkle celebration */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10">
        {BURST.map((b, i) => (
          <motion.span
            key={i}
            className="absolute text-brand-1"
            initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0, 1.2, 0.5],
              x: b.x,
              y: b.y,
            }}
            transition={{ duration: 1, delay: b.delay, ease: "easeOut" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </motion.span>
        ))}
      </div>

      <GlassCard className="border-brand-1/30 p-4 shadow-glow transition-shadow duration-300 hover:shadow-glow-lg">
        <div className="flex items-start justify-between gap-3">
          <h4 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
            <motion.span
              aria-hidden
              animate={{ rotate: [0, 14, -8, 0], scale: [1, 1.18, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="text-brand-1"
            >
              <Sparkles className="h-4 w-4" />
            </motion.span>
            {quiz.title}
          </h4>
          <div className="flex shrink-0 items-center gap-1">
            <Badge className="bg-brand-gradient text-white">Quiz</Badge>
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

        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            onClick={onStart}
            className="group mt-4 w-full gap-2 bg-brand-gradient text-white shadow-glow hover:shadow-glow-lg"
          >
            Start Quiz
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </motion.div>
      </GlassCard>
    </motion.div>
  );
}
