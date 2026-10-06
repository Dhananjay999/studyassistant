// Shown right after a topic is marked completed: "Nice work", the time
// studied, and the next topic to open (same day first, then the plan order).
// A bottom sheet on phones, a dialog on desktop.

import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Clock, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  dayLabel,
  formatMinutes,
  formatTimer,
  nextTopic,
  subjectTone,
} from "@/components/exam/examFormat";
import { useBackClose } from "@/hooks/useBackClose";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { ExamDashboard, ExamTopic } from "@/types";

export function NextUpSheet({
  open,
  onOpenChange,
  dashboard,
  topic,
  studySeconds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: ExamDashboard;
  /** The topic just completed. */
  topic: ExamTopic;
  /** Timer reading when it was completed. */
  studySeconds: number;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  useBackClose(open, () => onOpenChange(false));

  // The completed topic is excluded explicitly: the dashboard cache may still
  // hold its old status until the mutation settles.
  const next = nextTopic(dashboard, {
    preferDayId: topic.day_id,
    excludeTopicId: topic.id,
  });
  const studied =
    studySeconds >= 60
      ? formatMinutes(Math.round(studySeconds / 60))
      : studySeconds > 0
        ? formatTimer(studySeconds)
        : null;

  const startNext = () => {
    if (!next) return;
    analytics.track(AnalyticsEvent.EXAM_PREP_NEXT_UP_CLICKED, {
      plan_id: dashboard.plan.id,
      topic_id: next.topic.id,
      source: "sheet",
    });
    onOpenChange(false);
    navigate(`/exam/topic/${next.topic.id}`);
  };

  const backToToday = () => {
    onOpenChange(false);
    navigate("/exam");
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      analyticsName="Exam next up"
    >
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader className="items-center text-center sm:items-center sm:text-center">
          <motion.span
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            {next ? <Check className="h-7 w-7" /> : <PartyPopper className="h-7 w-7" />}
          </motion.span>
          {/* The accessible title is static; the subject is user content. */}
          <ResponsiveModalTitle className="sr-only">
            {next ? "Topic completed" : "All topics completed"}
          </ResponsiveModalTitle>
          <p
            className="font-display text-lg font-bold leading-snug tracking-tight [overflow-wrap:anywhere]"
            data-analytics-private
          >
            {next ? (
              <>
                Nice work — <span className={subjectTone(topic.subject).text}>{topic.subject}</span> done
              </>
            ) : (
              "That was the last one!"
            )}
          </p>
          <ResponsiveModalDescription className="flex items-center justify-center gap-1.5">
            {studied ? (
              <>
                <Clock className="h-3.5 w-3.5" /> You studied for {studied}
              </>
            ) : next ? (
              "Keep the momentum going."
            ) : (
              "Every topic in your plan is complete."
            )}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {next && (
          <div
            className="rounded-xl border border-border/50 bg-card/40 p-3"
            data-analytics-private
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Up next · {dayLabel(next.day, next.isToday)}
            </p>
            <p className={cn("mt-1.5 truncate text-xs font-medium", subjectTone(next.topic.subject).text)}>
              {next.topic.subject}
            </p>
            <p className="mt-0.5 line-clamp-2 font-display text-base font-bold leading-snug [overflow-wrap:anywhere]">
              {next.topic.title}
            </p>
            {next.topic.est_minutes > 0 && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {formatMinutes(next.topic.est_minutes)}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {next && (
            <Button
              variant="brand"
              onClick={startNext}
              data-analytics-name="Exam next up start next"
              className="h-12 w-full gap-2 text-base"
            >
              Start next topic <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant={next ? "outline" : "brand"}
            onClick={backToToday}
            data-analytics-name="Exam next up back"
            className="h-12 w-full"
          >
            Back to today
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
