// /exam — the Exam Prep dashboard ("where am I, what now"): countdown hero,
// a one-time "how it works" strip, the next topic to study, today's checklist,
// upcoming days, per-subject progress, the plan summary and "Start over".
// Tapping a topic opens its lesson page (/exam/topic/:id), where Aeva teaches it.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Lightbulb, RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/common/GlassCard";
import { Seo } from "@/components/common/Seo";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExamEmptyState } from "@/components/exam/ExamEmptyState";
import { ExamHeroCard } from "@/components/exam/ExamHeroCard";
import { HowItWorksStrip } from "@/components/exam/HowItWorksStrip";
import { NextUpCard } from "@/components/exam/NextUpCard";
import { SubjectsProgress } from "@/components/exam/SubjectsProgress";
import { TodayPlanCard } from "@/components/exam/TodayPlanCard";
import { UpcomingDaysList } from "@/components/exam/UpcomingDaysList";
import { ExamArtifactsProvider } from "@/components/exam/useExamArtifacts";
import { useAuth } from "@/contexts/AuthContext";
import { useArchiveExamPlan, useExamDashboard } from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { setExamPlanHint } from "@/lib/examPrepHome";
import { cn } from "@/lib/utils";
import { hasExamPlan, type ExamDashboard } from "@/types";

export default function ExamPrepPage() {
  const enabled = useFeature("exam_prep", false);
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useExamDashboard(enabled);
  const viewedPlan = useRef<string | null>(null);

  // Remember for the home redirect whether this account has an active plan.
  useEffect(() => {
    if (!data || !user?.id) return;
    setExamPlanHint(user.id, hasExamPlan(data));
  }, [data, user?.id]);

  useEffect(() => {
    if (!hasExamPlan(data) || viewedPlan.current === data.plan.id) return;
    viewedPlan.current = data.plan.id;
    analytics.track(AnalyticsEvent.EXAM_PREP_DASHBOARD_VIEWED, {
      plan_id: data.plan.id,
      days_remaining: data.days_remaining,
      progress_percent: data.progress.percent,
      has_today: !!data.today,
    });
  }, [data]);

  return (
    <PageContainer title="Exam Prep">
      <Seo title="Exam Prep — Aeva" noindex path="/exam" />
      <div className="mx-auto max-w-4xl space-y-6 lg:p-4">
        {isLoading || !enabled ? (
          <DashboardSkeleton />
        ) : isError || !data ? (
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load your exam plan.
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </GlassCard>
        ) : !hasExamPlan(data) ? (
          <ExamEmptyState />
        ) : (
          <ExamArtifactsProvider>
            <Dashboard data={data} userId={user?.id} />
          </ExamArtifactsProvider>
        )}
      </div>
    </PageContainer>
  );
}

function Dashboard({
  data,
  userId,
}: {
  data: ExamDashboard;
  userId?: string;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const confirm = useConfirm();
  const archive = useArchiveExamPlan();
  const { plan } = data;
  // Days not yet started: the plan may begin later than today.
  const upcoming =
    data.upcoming.length > 0
      ? data.upcoming
      : data.days.filter((d) => d.id !== data.today?.id).slice(0, 7);

  const startOver = async () => {
    const ok = await confirm({
      title: "Start over?",
      description:
        "Your current plan and its progress will be archived. You'll set up a new plan next.",
      confirmText: "Start over",
      destructive: true,
    });
    if (!ok) return;
    try {
      await archive.mutateAsync(plan.id);
      analytics.track(AnalyticsEvent.EXAM_PREP_PLAN_ARCHIVED, {
        plan_id: plan.id,
        days_remaining: data.days_remaining,
        progress_percent: data.progress.percent,
      });
      if (userId) setExamPlanHint(userId, false);
      navigate("/exam/setup");
    } catch {
      // The hook already invalidates; a toast-free retry is one tap away.
    }
  };

  return (
    <>
      <ExamHeroCard data={data} />
      {data.progress.completed === 0 && <HowItWorksStrip planId={plan.id} />}
      <NextUpCard
        dashboard={data}
        onSeeUpcoming={() =>
          document
            .getElementById("exam-upcoming")
            ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
        }
      />
      <TodayPlanCard day={data.today} nextDay={upcoming[0]} />
      <div id="exam-upcoming" className="scroll-mt-4">
        <UpcomingDaysList
          days={upcoming}
          title={data.today ? "Coming up" : "Your plan"}
        />
      </div>
      <SubjectsProgress subjects={data.subjects} />
      <PlanSummary summary={plan.plan_meta.summary} tips={plan.plan_meta.strategy_tips} />

      <div className="flex flex-col items-center gap-2 pb-20 pt-2 text-center lg:pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void startOver()}
          disabled={archive.isPending}
          data-analytics-name="Exam start over"
          className="h-11 gap-1.5 text-muted-foreground"
        >
          <RotateCcw className="h-4 w-4" /> Start over with a new plan
        </Button>
      </div>
    </>
  );
}

function PlanSummary({
  summary,
  tips,
}: {
  summary?: string;
  tips?: string[];
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const hasTips = !!tips && tips.length > 0;
  if (!summary && !hasTips) return null;

  return (
    <section>
      <GlassCard className="overflow-hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-analytics-name="Exam plan summary toggle"
          className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
            <Lightbulb className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base font-bold leading-tight">
              Plan summary & strategy
            </span>
            <span className="block text-xs text-muted-foreground">
              How Aeva laid out your days{hasTips ? ` · ${tips!.length} tips` : ""}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
        {open && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="learning-content space-y-3 border-t border-border/50 px-4 pb-4 pt-3 text-sm"
          >
            {summary && <p className="text-muted-foreground">{summary}</p>}
            {hasTips && (
              <ul className="space-y-2">
                {tips!.map((t, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-1" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </GlassCard>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-44 rounded-2xl" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  );
}
