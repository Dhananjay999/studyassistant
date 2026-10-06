// "Next up" on the dashboard: the one topic to study now (today's first
// unfinished topic, else the next day's) with a single Start / Continue
// button. When the whole plan is done it celebrates instead.

import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Clock, PartyPopper, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import {
  STATUS_LABEL,
  STATUS_TONE,
  dayLabel,
  formatMinutes,
  nextTopic,
  subjectTone,
} from "@/components/exam/examFormat";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { ExamDashboard } from "@/types";

export function NextUpCard({
  dashboard,
  onSeeUpcoming,
}: {
  dashboard: ExamDashboard;
  /** "See upcoming days" in the all-done state. */
  onSeeUpcoming?: () => void;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const next = nextTopic(dashboard);

  if (!next) {
    return (
      <GlassCard strong className="flex items-center gap-4 p-5">
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        >
          <PartyPopper className="h-6 w-6" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-tight">
            All caught up
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every topic in your plan is done. Revise any topic from your days.
          </p>
          {onSeeUpcoming && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSeeUpcoming}
              data-analytics-name="Exam next up see days"
              className="mt-3 h-11 gap-1.5"
            >
              See upcoming days <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </GlassCard>
    );
  }

  const { topic, day, isToday } = next;
  const tone = subjectTone(topic.subject);
  const statusTone = STATUS_TONE[topic.status];
  const inProgress = topic.status === "in_progress";

  const start = () => {
    analytics.track(AnalyticsEvent.EXAM_PREP_NEXT_UP_CLICKED, {
      plan_id: dashboard.plan.id,
      topic_id: topic.id,
      source: "dashboard",
    });
    navigate(`/exam/topic/${topic.id}`);
  };

  return (
    <GlassCard strong className="relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-8 -bottom-10 h-32 w-32 rounded-full bg-brand-2/10 blur-2xl"
      />
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-brand-1" />
        Next up
        <span className="font-normal normal-case tracking-normal">
          · {dayLabel(day, isToday)}
        </span>
      </p>
      <div className="mt-2" data-analytics-private>
        <p className={cn("truncate text-xs font-semibold", tone.text)}>
          {topic.subject}
        </p>
        <h3 className="mt-0.5 line-clamp-2 font-display text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
          {topic.title}
        </h3>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", statusTone.text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statusTone.dot)} />
          {STATUS_LABEL[topic.status]}
        </span>
        {topic.est_minutes > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            <Clock className="h-3.5 w-3.5" /> {formatMinutes(topic.est_minutes)}
          </span>
        )}
      </div>
      <Button
        variant="brand"
        onClick={start}
        data-analytics-name={inProgress ? "Exam next up continue" : "Exam next up start"}
        className="mt-4 h-12 w-full gap-2 text-base sm:w-auto sm:min-w-[11rem]"
      >
        <Play className="h-4 w-4 fill-current" />
        {inProgress ? "Continue" : "Start"}
      </Button>
    </GlassCard>
  );
}
