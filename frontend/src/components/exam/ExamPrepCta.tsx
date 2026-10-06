// Exam Prep call-to-action (feature flag `exam_prep`, default off).
//
// One small component for every entry point outside the Exam Prep pages: the
// chat empty state and welcome home (`variant="card"`) and the exam-intent
// banner above the composer (`variant="banner"`). It renders nothing while
// the flag is off, so the flag-off render tree is unchanged, and nothing
// until the dashboard query settles, so it never flips from "Create" to
// "Continue" in front of the user.

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CalendarCheck, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { useAuth } from "@/contexts/AuthContext";
import { useExamDashboard } from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import {
  analytics,
  AnalyticsEvent,
  type ExamPrepCtaSource,
} from "@/lib/analytics";
import { setExamPlanHint } from "@/lib/examPrepHome";
import { cn } from "@/lib/utils";
import { hasExamPlan } from "@/types";

const ENTER = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

export function ExamPrepCta({
  source,
  variant = "card",
  onDismiss,
  className,
}: {
  /** Where the CTA is rendered (analytics). */
  source: ExamPrepCtaSource;
  /** `card` on the chat home; `banner` is the one-row strip above the composer. */
  variant?: "card" | "banner";
  /** Banner only: shows a dismiss button that calls this. */
  onDismiss?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const enabled = useFeature("exam_prep", false);
  const { data, isError } = useExamDashboard(enabled);
  const hasPlan = hasExamPlan(data);
  const settled = enabled && (data !== undefined || isError);
  const daysLeft = hasPlan ? data.days_remaining : 0;

  // Keep the post-login home decision in step with the server (see
  // lib/examPrepHome.ts): true while a plan is active, cleared once it isn't.
  useEffect(() => {
    if (user?.id && data !== undefined) setExamPlanHint(user.id, hasPlan);
  }, [user?.id, data, hasPlan]);

  // One impression per mount, reported with the right `has_plan`.
  const shownRef = useRef(false);
  useEffect(() => {
    if (!settled || shownRef.current) return;
    shownRef.current = true;
    analytics.track(AnalyticsEvent.EXAM_PREP_CTA_SHOWN, {
      source,
      has_plan: hasPlan,
    });
  }, [settled, source, hasPlan]);

  if (!settled) return null;

  const open = () => {
    analytics.track(AnalyticsEvent.EXAM_PREP_CTA_CLICKED, {
      source,
      has_plan: hasPlan,
    });
    navigate(hasPlan ? "/exam" : "/exam/setup");
  };

  const title = hasPlan
    ? `Continue Exam Prep · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
    : "Preparing for an exam?";
  const subtitle = hasPlan
    ? "Pick up today's topics, quizzes and flashcards."
    : "Get a day-by-day study plan built around your exam date.";
  const action = hasPlan ? "Open" : "Create exam plan";
  // Banner on a phone: keeps room for the title at 320–360px.
  const actionShort = hasPlan ? "Open" : "Create plan";
  const actionName = hasPlan ? "Open exam prep" : "Create exam plan";
  const Icon = hasPlan ? CalendarCheck : Target;
  const motionProps = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: ENTER,
  };

  if (variant === "banner") {
    return (
      <motion.div {...motionProps} className={cn("w-full", className)}>
        <div
          role="status"
          className="glass flex items-center gap-2 rounded-xl border-brand-1/30 bg-brand-1/5 py-1 pl-3 pr-1"
        >
          <Icon className="h-4 w-4 shrink-0 text-brand-1" />
          <span className="min-w-0 flex-1 line-clamp-2 text-xs leading-snug">
            <span className="font-medium">{title}</span>
            <span className="hidden text-muted-foreground sm:inline">
              {" "}
              — {subtitle}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="brand"
            data-analytics-name={actionName}
            onClick={open}
            className="h-11 shrink-0 rounded-lg px-3 text-xs"
          >
            <span className="sm:hidden">{actionShort}</span>
            <span className="hidden sm:inline">{action}</span>
            <ArrowRight className="!size-3.5" />
          </Button>
          {onDismiss && (
            <button
              type="button"
              aria-label="Dismiss"
              data-analytics-name="Dismiss exam prep banner"
              onClick={onDismiss}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div {...motionProps} className={cn("w-full", className)}>
      <GlassCard className="flex flex-col gap-3 p-4 text-left sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-bold leading-tight">
              {title}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="brand"
          data-analytics-name={actionName}
          onClick={open}
          className="h-11 w-full shrink-0 rounded-xl sm:w-auto"
        >
          {action}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </GlassCard>
    </motion.div>
  );
}
