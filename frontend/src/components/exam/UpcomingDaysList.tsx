// The next days of the plan as compact rows: Day n · date · title · x/y done.
// Tapping a row expands it (accordion) to show that day's topics as tappable
// steps, so the student can look ahead without leaving the dashboard; a
// "Full day plan" link opens the day page with its time blocks and detail.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarRange, ChevronDown, ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { SectionHeading } from "@/components/exam/TodayPlanCard";
import { TopicStepRow } from "@/components/exam/TopicStepRow";
import { dayTopics, formatPlanDate, percentOf } from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamDaySummary } from "@/types";

export function UpcomingDaysList({
  days,
  title = "Coming up",
}: {
  days: ExamDaySummary[];
  title?: string;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>(null);
  if (days.length === 0) return null;

  return (
    <section>
      <SectionHeading icon={<CalendarRange className="h-4 w-4 text-brand-1" />}>
        {title}
      </SectionHeading>
      <GlassCard
        className="divide-y divide-border/50 overflow-hidden"
        data-analytics-private
        data-analytics-section="exam_upcoming_days"
      >
        {days.map((d, i) => {
          const pct = percentOf(d.completed_count, d.topic_count);
          const done = d.topic_count > 0 && d.completed_count === d.topic_count;
          const open = openId === d.id;
          const topics = dayTopics(d);
          return (
            <motion.div
              key={d.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.24) }}
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : d.id)}
                data-analytics-name="Exam upcoming day toggle"
                className="flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/50 active:scale-[0.995]"
              >
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-center leading-none",
                    done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-brand-1/10 text-brand-1",
                  )}
                >
                  <span className="block text-[10px] font-semibold uppercase">
                    Day
                  </span>
                  <span className="block font-display text-base font-extrabold tabular-nums">
                    {d.day_number}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {d.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">{formatPlanDate(d.date)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 tabular-nums">
                      {d.completed_count}/{d.topic_count} done
                    </span>
                    {pct > 0 && (
                      <span className="hidden h-1 flex-1 overflow-hidden rounded-full bg-secondary sm:block">
                        <span
                          className="block h-full origin-left rounded-full bg-brand-1"
                          style={{ transform: `scaleX(${pct / 100})` }}
                        />
                      </span>
                    )}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="topics"
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border/40 bg-muted/20 pb-2"
                  >
                    {topics.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">
                        A rest day — nothing scheduled.
                      </p>
                    ) : (
                      <div className="divide-y divide-border/30">
                        {topics.map((t, idx) => (
                          <TopicStepRow key={t.id} topic={t} step={idx + 1} index={idx} />
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate(`/exam/day/${d.id}`)}
                      data-analytics-name="Exam open day"
                      className="flex min-h-[44px] w-full items-center justify-end gap-1 px-4 text-sm font-semibold text-brand-1 hover:underline"
                    >
                      Full day plan <ChevronRight className="h-4 w-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </GlassCard>
    </section>
  );
}
