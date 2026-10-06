// Dashboard hero: exam name and date, the countdown, overall progress and the
// "Today" chip. The progress bar animates its first fill once per mount.

import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, Target } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import {
  daysRemainingLabel,
  examDayState,
  formatPlanDate,
} from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamDashboard } from "@/types";

export function ExamHeroCard({ data }: { data: ExamDashboard }) {
  const reduce = useReducedMotion();
  const { plan, progress } = data;
  const state = examDayState(plan.exam_date, data.days_remaining);
  const label = daysRemainingLabel(data.days_remaining, state);
  const pct = Math.max(0, Math.min(100, progress.percent));

  return (
    <GlassCard strong className="relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-1/10 blur-2xl"
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0" data-analytics-private>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-brand-1" /> Preparing for
          </p>
          <h2 className="mt-1 line-clamp-2 font-display text-xl font-extrabold leading-tight [overflow-wrap:anywhere] sm:text-2xl">
            {plan.exam_name}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {formatPlanDate(plan.exam_date, "long")}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
          <p
            className={cn(
              "font-display text-3xl font-extrabold tabular-nums leading-none sm:text-4xl",
              state === "upcoming"
                ? "bg-gradient-to-r from-brand-1 to-brand-2 bg-clip-text text-transparent"
                : "text-brand-1",
            )}
          >
            {state === "upcoming" ? data.days_remaining : label}
          </p>
          {state === "upcoming" && (
            <p className="text-sm font-medium text-muted-foreground">
              {label.replace(/^\d+\s/, "")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">
              {progress.completed}
            </span>{" "}
            of {progress.total_topics} topics done
          </span>
          <span className="font-semibold tabular-nums">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          <motion.div
            className="h-full origin-left rounded-full bg-gradient-to-r from-brand-1 to-brand-2"
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: pct / 100 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{ width: "100%" }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data.today_day_number ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-1/10 px-2.5 py-1 text-xs font-semibold text-brand-1">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-1" />
              Today · Day {data.today_day_number} of {plan.total_days}
            </span>
          ) : (
            <span className="rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {plan.total_days}-day plan
            </span>
          )}
          {progress.in_progress > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              {progress.in_progress} in progress
            </span>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
