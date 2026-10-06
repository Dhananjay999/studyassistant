// One line of the day checklist on the dashboard: step number (a check once
// completed), subject · title, minutes and a chevron. The whole row is a
// button that opens the topic page; Quiz / Flashcards live on the day page
// and the topic page, not here.

import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { formatMinutes, subjectTone } from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamTopic } from "@/types";

export function TopicStepRow({
  topic,
  step,
  index = 0,
}: {
  topic: ExamTopic;
  /** 1-based position in the day. */
  step: number;
  /** Position in its list, for the staggered entrance. */
  index?: number;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const tone = subjectTone(topic.subject);
  const done = topic.status === "completed";
  const active = topic.status === "in_progress";

  return (
    <motion.button
      type="button"
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.24) }}
      whileTap={reduce ? undefined : { scale: 0.995 }}
      onClick={() => navigate(`/exam/topic/${topic.id}`)}
      data-analytics-name="Exam today step"
      className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-accent/50"
    >
      <span
        aria-hidden
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums",
          done
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : active
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-muted/70 text-muted-foreground",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : step}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs">
          <span className={cn("truncate font-medium", tone.text)}>
            {topic.subject}
          </span>
          {active && (
            <span className="shrink-0 text-amber-600 dark:text-amber-400">
              In progress
            </span>
          )}
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-sm font-medium",
            done && "text-muted-foreground line-through decoration-muted-foreground/60",
          )}
        >
          {topic.title}
        </span>
      </span>
      {topic.est_minutes > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatMinutes(topic.est_minutes)}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </motion.button>
  );
}
