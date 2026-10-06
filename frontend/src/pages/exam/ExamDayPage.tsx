// /exam/day/:dayId — the agenda for one day of the plan: a "Start day" /
// "Continue day" button that opens the day's next unfinished topic, then the
// numbered topic rows. Topics render instantly from the dashboard cache; the
// detailed plan (overview, time blocks, per-topic objectives / key points /
// practice / mistakes) is generated lazily on the first open and shown with a
// skeleton meanwhile.

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/common/GlassCard";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { Seo } from "@/components/common/Seo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TopicRow } from "@/components/exam/TopicRow";
import {
  dayTopics,
  formatMinutes,
  formatPlanDate,
  nextTopicInDay,
  subjectTone,
} from "@/components/exam/examFormat";
import { ExamArtifactsProvider } from "@/components/exam/useExamArtifacts";
import { qk, useExamDashboard, useExamDay } from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
  hasExamPlan,
  type ExamDayDetail,
  type ExamDayDetailBody,
  type ExamDayDetailTopic,
  type ExamDaySummary,
  type ExamPlan,
} from "@/types";

const PREPARING = [
  "Aeva is preparing your day plan…",
  "Picking the key points for each topic…",
  "Adding practice and common mistakes…",
];

export default function ExamDayPage() {
  const { dayId } = useParams<{ dayId: string }>();
  const navigate = useNavigate();
  const enabled = useFeature("exam_prep", false);
  const dashboard = useExamDashboard(enabled);
  const plan = hasExamPlan(dashboard.data) ? dashboard.data : null;
  const summary = plan?.days.find((d) => d.id === dayId);

  if (dashboard.isLoading || !enabled) {
    return (
      <PageContainer title="Exam Prep">
        <Seo title="Study day — Aeva" noindex path="/exam" />
        <div className="mx-auto max-w-3xl space-y-4 lg:p-4">
          <Skeleton className="h-10 w-40 rounded" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      </PageContainer>
    );
  }

  if (dashboard.isError) {
    return (
      <PageContainer title="Exam Prep">
        <Seo title="Study day — Aeva" noindex path="/exam" />
        <div className="mx-auto max-w-3xl lg:p-4">
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load your exam plan.
            </p>
            <Button variant="outline" onClick={() => dashboard.refetch()}>
              Retry
            </Button>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  if (!plan) return <Navigate to="/exam" replace />;

  if (!summary) {
    return (
      <PageContainer title="Exam Prep">
        <Seo title="Study day — Aeva" noindex path="/exam" />
        <div className="mx-auto max-w-3xl lg:p-4">
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="font-display font-bold">This day isn't in your plan</p>
            <p className="text-sm text-muted-foreground">
              It may belong to an older plan.
            </p>
            <Button variant="brand" onClick={() => navigate("/exam")}>
              Back to Exam Prep
            </Button>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Exam Prep">
      <Seo title="Study day — Aeva" noindex path="/exam" />
      <ExamArtifactsProvider>
        <DayView
          plan={plan.plan}
          summary={summary}
          isToday={plan.today?.id === summary.id}
        />
      </ExamArtifactsProvider>
    </PageContainer>
  );
}

function DayView({
  plan,
  summary,
  isToday,
}: {
  plan: ExamPlan;
  summary: ExamDaySummary;
  isToday: boolean;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const detailQ = useExamDay(plan.id, summary.id);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const openedFor = useRef<string | null>(null);
  const failedFor = useRef<unknown>(null);

  useEffect(() => {
    if (openedFor.current === summary.id) return;
    openedFor.current = summary.id;
    // The dashboard summary can lag a detail generated on an earlier open
    // (it is cached for a minute), so the day cache counts too.
    const cached = qc.getQueryData<ExamDayDetail>(qk.examDay(plan.id, summary.id));
    analytics.track(AnalyticsEvent.EXAM_PREP_DAY_OPENED, {
      plan_id: plan.id,
      day_id: summary.id,
      day_number: summary.day_number,
      topic_count: summary.topic_count,
      had_detail: summary.has_detail || !!cached?.detail,
    });
  }, [qc, plan.id, summary.id, summary.day_number, summary.topic_count, summary.has_detail]);

  useEffect(() => {
    if (!detailQ.isError || failedFor.current === detailQ.error) return;
    failedFor.current = detailQ.error;
    analytics.track(AnalyticsEvent.EXAM_PREP_DAY_DETAIL_FAILED, {
      plan_id: plan.id,
      day_id: summary.id,
      error_kind: errorKind(detailQ.error),
    });
  }, [detailQ.isError, detailQ.error, plan.id, summary.id]);

  // Topics come from the freshest copy available (the detail carries the same
  // rows); status edits patch both caches.
  const day = detailQ.data ?? summary;
  const detail: ExamDayDetailBody | null = detailQ.data?.detail ?? null;
  const detailByTopic = new Map<string, ExamDayDetailTopic>(
    (detail?.topics ?? []).map((t) => [t.topic_id, t]),
  );
  const totalMinutes = day.subjects
    .flatMap((s) => s.topics)
    .reduce((sum, t) => sum + (t.est_minutes || 0), 0);
  const allDone = day.topic_count > 0 && day.completed_count === day.topic_count;
  // Step numbers follow the flattened subject order, like the dashboard.
  const stepOf = new Map(dayTopics(day).map((t, i) => [t.id, i + 1]));
  const next = nextTopicInDay(day);
  const started = day.completed_count > 0 || day.in_progress_count > 0;

  const startDay = () => {
    if (!next) return;
    analytics.track(AnalyticsEvent.EXAM_PREP_NEXT_UP_CLICKED, {
      plan_id: plan.id,
      topic_id: next.id,
      source: "day",
    });
    navigate(`/exam/topic/${next.id}`);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24 lg:p-4 lg:pb-8">
      {/* Header: the back arrow sits on the eyebrow line; the title gets the
          full width underneath so long titles never wrap beside the button. */}
      <header data-analytics-private>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to Exam Prep"
            onClick={() => navigate("/exam")}
            className="-ml-2 h-11 w-11 shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="truncate">
              Day {day.day_number} · {formatPlanDate(day.date)}
            </span>
            {isToday && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-1/10 px-2 py-0.5 text-[11px] font-semibold text-brand-1">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-1" />
                Today
              </span>
            )}
          </p>
        </div>
        <h2 className="mt-1 font-display text-xl font-extrabold leading-tight [overflow-wrap:anywhere]">
          {day.title}
        </h2>
        {day.focus && (
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {day.focus}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium tabular-nums",
              allDone
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted/60 text-muted-foreground",
            )}
          >
            {allDone && <CheckCircle2 className="h-3.5 w-3.5" />}
            {day.completed_count} of {day.topic_count} done
          </span>
          {totalMinutes > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> {formatMinutes(totalMinutes)}
            </span>
          )}
        </div>
      </header>

      {next && (
        <Button
          variant="brand"
          onClick={startDay}
          data-analytics-name={started ? "Exam continue day" : "Exam start day"}
          className="h-12 w-full gap-2 text-base sm:w-auto sm:min-w-[12rem]"
        >
          <Play className="h-4 w-4 fill-current" />
          {started ? "Continue day" : "Start day"}
        </Button>
      )}

      {/* Lazily generated day detail */}
      {detailQ.isPending ? (
        <GlassCard className="p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-brand-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <RotatingStatus messages={PREPARING} intervalMs={2600} />
          </p>
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3.5 w-full rounded" />
            <Skeleton className="h-3.5 w-11/12 rounded" />
            <Skeleton className="h-3.5 w-2/3 rounded" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-8 w-36 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </GlassCard>
      ) : detailQ.isError ? (
        <GlassCard className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold">
              Aeva couldn't prepare the detailed plan
            </p>
            <p className="text-xs text-muted-foreground">
              Your topics are still here. Try again in a moment.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => detailQ.refetch()}
            data-analytics-name="Exam day detail retry"
            className="h-11 w-full sm:w-auto"
          >
            Retry
          </Button>
        </GlassCard>
      ) : detail ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-3"
        >
          <GlassCard strong className="learning-content p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-brand-1" /> Today's game plan
            </p>
            <p className="mt-2 text-sm leading-relaxed">{detail.overview}</p>
            {detail.time_blocks.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" data-analytics-private>
                {detail.time_blocks.map((b, i) => (
                  <li
                    key={i}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-brand-1" />
                    <span className="truncate font-medium">{b.label}</span>
                    {b.minutes > 0 && (
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        · {formatMinutes(b.minutes)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </motion.div>
      ) : null}

      {/* Topics by subject */}
      <div
        className="space-y-5"
        data-analytics-private
        data-analytics-section="exam_day_topics"
      >
        {day.subjects.map((group) => {
          const tone = subjectTone(group.subject);
          return (
            <section key={group.subject}>
              <h3 className="mb-2 flex items-center gap-2 px-1 font-display text-sm font-bold">
                <span className={cn("h-2.5 w-2.5 rounded-full", tone.bar)} />
                <span className="truncate">{group.subject}</span>
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {group.topics.filter((t) => t.status === "completed").length}/
                  {group.topics.length}
                </span>
              </h3>
              <div className="space-y-2">
                {group.topics.map((t, i) => {
                  const td = detailByTopic.get(t.id);
                  return (
                    <TopicRow
                      key={t.id}
                      topic={t}
                      examName={plan.exam_name}
                      source="day"
                      index={i}
                      showSubject={false}
                      step={stepOf.get(t.id)}
                      expanded={expanded.has(t.id)}
                      onToggleExpanded={td ? () => toggle(t.id) : undefined}
                    >
                      {td && <TopicDetail detail={td} />}
                    </TopicRow>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {detail?.wrap_up && (
        <GlassCard className="learning-content p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wrap up
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">{detail.wrap_up}</p>
        </GlassCard>
      )}
    </div>
  );
}

const DETAIL_SECTIONS: {
  key: keyof Omit<ExamDayDetailTopic, "topic_id">;
  label: string;
  tone: string;
}[] = [
  { key: "objectives", label: "Objectives", tone: "bg-brand-1" },
  { key: "key_points", label: "Key points", tone: "bg-sky-500" },
  { key: "practice", label: "Practice", tone: "bg-emerald-500" },
  { key: "common_mistakes", label: "Common mistakes", tone: "bg-amber-500" },
];

function TopicDetail({ detail }: { detail: ExamDayDetailTopic }) {
  const sections = DETAIL_SECTIONS.filter((s) => detail[s.key]?.length > 0);
  if (sections.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No extra notes for this topic.
      </p>
    );
  }
  return (
    <div className="learning-content grid gap-3 sm:grid-cols-2">
      {sections.map((s) => (
        <div key={s.key}>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", s.tone)} />
            {s.label}
          </p>
          <ul className="space-y-1 text-sm">
            {detail[s.key].map((line, i) => (
              <li key={i} className="flex gap-2 [overflow-wrap:anywhere]">
                <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
