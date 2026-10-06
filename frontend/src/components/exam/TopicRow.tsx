// One topic of the plan: status control, subject · title · time, and the two
// prominent actions (Quiz, Flashcards) with an overflow sheet for the rest.
// The card itself opens the topic page (/exam/topic/:id) where Aeva teaches
// the topic; the inner controls keep working in place. Used on the dashboard
// (today's topics) and the day page (where it can expand to show the lazily
// generated per-topic detail passed as `children`).

import { useState, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { TopicActionSheet } from "@/components/exam/TopicActionSheet";
import { TopicStatusDot } from "@/components/exam/TopicStatusDot";
import { formatMinutes, subjectTone } from "@/components/exam/examFormat";
import { useTopicActions } from "@/components/exam/useTopicActions";
import type { ExamPrepActionSource } from "@/lib/analytics/events";
import { cn } from "@/lib/utils";
import type { ExamTopic } from "@/types";

export function TopicRow({
  topic,
  examName,
  source,
  index = 0,
  showSubject = true,
  step,
  expanded,
  onToggleExpanded,
  children,
}: {
  topic: ExamTopic;
  examName: string;
  source: Extract<ExamPrepActionSource, "row" | "day">;
  /** Position in its list, for the staggered entrance. */
  index?: number;
  showSubject?: boolean;
  /** 1-based step number shown before the meta line (an ordered agenda). */
  step?: number;
  /** When `onToggleExpanded` is given, a Details toggle reveals `children`. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const actions = useTopicActions(topic, examName, source);
  const [sheetOpen, setSheetOpen] = useState(false);
  const tone = subjectTone(topic.subject);
  const done = actions.status === "completed";
  const best = topic.quiz_summary?.best_score;

  // The card surface opens the lesson; taps that land on an inner control
  // (status dot, buttons, the expanded detail) keep their own behaviour.
  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [data-no-open]")) return;
    actions.open();
  };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.04, 0.24) }}
    >
      <GlassCard
        onClick={onCardClick}
        className={cn(
          "cursor-pointer p-3 transition-colors hover:bg-accent/30",
          done && "opacity-80",
        )}
      >
        <div className="flex items-start gap-2">
          <TopicStatusDot
            status={actions.status}
            busy={actions.statusBusy}
            onClick={() => actions.cycleStatus(source)}
            className="-ml-1 -mt-1"
          />
          {/* The text column is the accessible way in (keyboard, screen
              readers); the card's onClick covers the padding around it. */}
          <button
            type="button"
            onClick={actions.open}
            data-analytics-name="Exam topic open"
            className="group/open min-w-0 flex-1 rounded-lg pt-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {step !== undefined && (
                <span
                  className={cn(
                    "grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[11px] font-bold tabular-nums",
                    done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-brand-1/10 text-brand-1",
                  )}
                >
                  {step}
                </span>
              )}
              {showSubject && (
                <span className={cn("truncate font-medium", tone.text)}>
                  {topic.subject}
                </span>
              )}
              {topic.est_minutes > 0 && (
                <span className="shrink-0 tabular-nums">
                  {formatMinutes(topic.est_minutes)}
                </span>
              )}
            </span>
            <span
              className={cn(
                "mt-0.5 block font-display text-[15px] font-bold leading-snug [overflow-wrap:anywhere]",
                done && "line-through decoration-muted-foreground/60",
              )}
            >
              {topic.title}
            </span>
            {topic.description && (
              <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {topic.description}
              </span>
            )}
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {typeof best === "number" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-0 bg-emerald-500/15 text-emerald-600 tabular-nums dark:text-emerald-400"
                >
                  <Trophy className="h-3 w-3" /> Best {Math.round(best)}%
                </Badge>
              )}
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-1">
                {topic.has_lesson ? "Open lesson" : "Learn with Aeva"}
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/open:translate-x-0.5" />
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="More actions"
            data-analytics-name="Exam topic more"
            onClick={() => setSheetOpen(true)}
            className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* Actions share the card width and wrap at the narrowest screens. */}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={topic.quiz_id ? "brand" : "outline"}
            disabled={actions.quizBusy}
            onClick={() => void actions.quiz(source)}
            data-analytics-name="Exam topic quiz"
            className="h-11 min-w-[7.5rem] flex-1 gap-1.5 px-3 text-sm"
          >
            {actions.quizBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
            {actions.quizBusy
              ? topic.quiz_id
                ? "Opening…"
                : "Creating…"
              : topic.quiz_id
                ? "Take quiz"
                : "Quiz"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={actions.flashcardsBusy}
            onClick={() => void actions.flashcards(source)}
            data-analytics-name="Exam topic flashcards"
            className="h-11 min-w-[7.5rem] flex-1 gap-1.5 px-3 text-sm"
          >
            {actions.flashcardsBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
            {actions.flashcardsBusy ? "Creating…" : "Flashcards"}
          </Button>
          {onToggleExpanded && (
            <Button
              type="button"
              variant="ghost"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              data-analytics-name="Exam topic details"
              className="h-11 gap-1 px-3 text-sm text-muted-foreground"
            >
              Details
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  expanded && "rotate-180",
                )}
              />
            </Button>
          )}
        </div>

        {onToggleExpanded && (
          <AnimatePresence initial={false}>
            {expanded && children && (
              <motion.div
                key="detail"
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="mt-3 border-t border-border/50 pt-3"
                data-no-open
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </GlassCard>

      <TopicActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        topic={topic}
        actions={actions}
      />
    </motion.div>
  );
}
