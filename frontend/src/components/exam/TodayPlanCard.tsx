// Today's session on the dashboard as a compact numbered checklist: "x of y
// done · N min planned", a thin progress bar and one TopicStepRow per topic,
// with a link to the full day plan. A rest/empty state when no day is
// scheduled for today.

import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Coffee, Sun } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { TopicStepRow } from "@/components/exam/TopicStepRow";
import {
  dayMinutes,
  dayTopics,
  formatMinutes,
  formatPlanDate,
  percentOf,
} from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamDaySummary } from "@/types";

export function TodayPlanCard({
  day,
  nextDay,
}: {
  day: ExamDaySummary | null;
  /** The first upcoming day, for the rest-day copy. */
  nextDay?: ExamDaySummary;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  if (!day) {
    return (
      <section>
        <SectionHeading icon={<Sun className="h-4 w-4 text-amber-500" />}>
          Today
        </SectionHeading>
        <GlassCard className="flex items-center gap-4 p-5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Coffee className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="font-display font-bold">No session planned today</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {nextDay
                ? `Your next study day is Day ${nextDay.day_number} · ${formatPlanDate(nextDay.date)}.`
                : "Take a breather, or open any topic for a quick revision lesson."}
            </p>
          </div>
        </GlassCard>
      </section>
    );
  }

  const topics = dayTopics(day);
  const minutes = dayMinutes(day);
  const pct = percentOf(day.completed_count, day.topic_count);
  const allDone = day.topic_count > 0 && day.completed_count === day.topic_count;

  return (
    <section>
      <SectionHeading icon={<Sun className="h-4 w-4 text-amber-500" />}>
        Today · Day {day.day_number}
        <span className="font-normal normal-case tracking-normal">
          · {formatPlanDate(day.date)}
        </span>
      </SectionHeading>

      <GlassCard
        className="overflow-hidden"
        data-analytics-private
        data-analytics-section="exam_today_topics"
      >
        <div className="px-4 pt-4">
          <h3 className="font-display text-base font-bold leading-tight [overflow-wrap:anywhere]">
            {day.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            <span className={cn(allDone && "font-semibold text-emerald-600 dark:text-emerald-400")}>
              {day.completed_count} of {day.topic_count} done
            </span>
            {minutes > 0 && ` · ${formatMinutes(minutes)} planned`}
          </p>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-secondary"
          >
            <motion.div
              className={cn(
                "h-full origin-left rounded-full",
                allDone ? "bg-emerald-500" : "bg-gradient-to-r from-brand-1 to-brand-2",
              )}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: pct / 100 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <ol className="mt-2 divide-y divide-border/50">
          {topics.map((t, i) => (
            <li key={t.id}>
              <TopicStepRow topic={t} step={i + 1} index={i} />
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => navigate(`/exam/day/${day.id}`)}
          data-analytics-name="Exam open today"
          className="flex min-h-[48px] w-full items-center justify-center gap-1.5 border-t border-border/50 px-4 text-sm font-semibold text-brand-1 transition-colors hover:bg-accent/50"
        >
          See full day plan <ArrowRight className="h-4 w-4" />
        </button>
      </GlassCard>
    </section>
  );
}

export function SectionHeading({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "mb-3 flex flex-wrap items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {icon}
      {children}
    </h2>
  );
}
