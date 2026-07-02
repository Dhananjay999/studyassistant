import { format, parseISO } from "date-fns";
import {
  BarChart3,
  Bookmark,
  Brain,
  Clock,
  FileText,
  Flame,
  Layers,
  ListChecks,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { useAnalytics } from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { AnalyticsOverview } from "@/types";

/** "2h 15m" / "45m" / "0m" from a duration in minutes. */
function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0) return r > 0 ? `${h}h ${r}m` : `${h}h`;
  return `${r}m`;
}

function shortDay(iso: string): string {
  try {
    return format(parseISO(iso), "EEE");
  } catch {
    return iso.slice(5);
  }
}

function fullDay(iso: string): string {
  try {
    return format(parseISO(iso), "EEE, MMM d");
  } catch {
    return iso;
  }
}

export default function AnalyticsPage() {
  const { data, isLoading } = useAnalytics();

  return (
    <AppShell title="Analytics">
      <Seo title="Analytics — Aeva" noindex path="/analytics" />
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        {isLoading || !data ? (
          <DashboardSkeleton />
        ) : (
          <Dashboard data={data} />
        )}
      </div>
    </AppShell>
  );
}

function Dashboard({ data }: { data: AnalyticsOverview }) {
  const { overview, quiz_analytics: quiz, activity, streak, subjects, achievements } =
    data;

  const overviewTiles = [
    { label: "Study Time", value: formatMinutes(overview.total_study_minutes), icon: Clock },
    { label: "Questions Asked", value: overview.total_questions_asked, icon: MessageSquare },
    { label: "AI Responses", value: overview.total_ai_responses, icon: Sparkles },
    { label: "Documents", value: overview.uploaded_documents, icon: FileText },
    { label: "Quizzes Created", value: overview.quizzes_created, icon: ListChecks },
    { label: "Flashcard Sets", value: overview.flashcards_created, icon: Layers },
  ];

  const hasActivity = activity.some((d) => d.questions > 0 || d.quizzes > 0);
  const maxSubject = Math.max(1, ...subjects.map((s) => s.count));

  return (
    <>
      {/* Streak banner */}
      <GlassCard className="flex items-center gap-4 bg-brand-1/5 p-5">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-1/10">
          <Flame
            className={cn(
              "h-7 w-7",
              streak > 0 ? "text-orange-500" : "text-muted-foreground",
            )}
          />
        </div>
        <div>
          <p className="font-display text-2xl font-extrabold">
            {streak} day{streak === 1 ? "" : "s"}
          </p>
          <p className="text-sm text-muted-foreground">
            {streak > 0
              ? "Study streak — keep the momentum going!"
              : "Ask a question or take a quiz to start a streak."}
          </p>
        </div>
      </GlassCard>

      {/* Learning Overview */}
      <Section title="Learning Overview" icon={BarChart3}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {overviewTiles.map((t) => (
            <StatTile key={t.label} {...t} />
          ))}
        </div>
      </Section>

      {/* Quiz Analytics */}
      <Section title="Quiz Analytics" icon={Target}>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-3 lg:col-span-1">
            <StatTile label="Attempted" value={quiz.quizzes_attempted} icon={ListChecks} />
            <StatTile label="Attempts" value={quiz.attempts} icon={TrendingUp} />
            <StatTile label="Avg Score" value={`${quiz.average_score}%`} icon={Brain} />
            <StatTile label="Best Score" value={`${quiz.best_score}%`} icon={Sparkles} />
            <div className="col-span-2">
              <StatTile
                label="Accuracy"
                value={`${quiz.accuracy}%`}
                icon={Target}
                extra={<Progress value={quiz.accuracy} className="mt-2 h-1.5" />}
              />
            </div>
          </div>

          <GlassCard className="p-4 lg:col-span-2">
            <p className="mb-3 text-sm font-medium">Performance Over Time</p>
            {quiz.trend.length > 0 ? (
              <TrendChart data={quiz.trend} />
            ) : (
              <EmptyChart label="Take a quiz to see your score trend." />
            )}
          </GlassCard>
        </div>
      </Section>

      {/* Learning Progress */}
      <Section title="Learning Progress" icon={TrendingUp}>
        <GlassCard className="p-4">
          <p className="mb-3 text-sm font-medium">Activity (last 14 days)</p>
          {hasActivity ? (
            <ActivityBars data={activity} />
          ) : (
            <EmptyChart label="Your daily activity will appear here." />
          )}
          <div className="mt-3 flex items-center justify-center gap-5 text-xs text-muted-foreground">
            <LegendDot color="hsl(var(--brand-1))" label="Questions" />
            <LegendDot color="hsl(var(--brand-3))" label="Quizzes" />
          </div>
        </GlassCard>
      </Section>

      {/* Subject Breakdown */}
      <Section title="Subject Breakdown" icon={Layers}>
        <GlassCard className="p-4">
          {subjects.length > 0 ? (
            <ul className="space-y-3">
              {subjects.map((s) => (
                <li key={s.subject} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm font-medium">
                    {s.subject}
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full bg-brand-gradient"
                      style={{ width: `${(s.count / maxSubject) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {s.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Generate quizzes or flashcards to see where you study most.
            </p>
          )}
        </GlassCard>
      </Section>

      {/* Achievements */}
      <Section title="Achievements" icon={Sparkles}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {achievements.map((a) => {
            const pct = Math.round((a.progress / a.target) * 100);
            return (
              <GlassCard
                key={a.key}
                className={cn(
                  "flex flex-col items-center p-4 text-center transition-opacity",
                  !a.unlocked && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "mb-2 grid h-12 w-12 place-items-center rounded-2xl text-2xl",
                    a.unlocked ? "bg-brand-1/10" : "bg-muted grayscale",
                  )}
                >
                  {a.icon}
                </span>
                <p className="text-xs font-semibold leading-tight">{a.title}</p>
                {a.unlocked ? (
                  <span className="mt-2 rounded-full bg-brand-1/10 px-2 py-0.5 text-[10px] font-medium text-brand-1">
                    Unlocked
                  </span>
                ) : (
                  <>
                    <Progress value={pct} className="mt-2 h-1" />
                    <span className="mt-1 text-[10px] text-muted-foreground">
                      {a.progress}/{a.target}
                    </span>
                  </>
                )}
              </GlassCard>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BarChart3;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-brand-1" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  extra,
}: {
  label: string;
  value: string | number;
  icon: typeof BarChart3;
  extra?: React.ReactNode;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-extrabold tabular-nums">
        {value}
      </p>
      {extra}
    </GlassCard>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-[200px] place-items-center text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

/**
 * Lightweight score-trend chart (area + line) drawn as inline SVG — avoids
 * pulling a charting library into this route's bundle. The SVG stretches to
 * fill its container; strokes stay crisp via `vectorEffect`.
 */
function TrendChart({ data }: { data: Array<{ date: string; score: number }> }) {
  const W = 100;
  const H = 100;
  const n = data.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (s: number) => H - (Math.min(100, Math.max(0, s)) / 100) * H;

  const line = data.map((d, i) => `${x(i).toFixed(2)},${y(d.score).toFixed(2)}`);
  const area = `0,${H} ${line.join(" ")} ${W},${H}`;

  return (
    <div className="flex gap-2">
      <div className="flex h-[200px] flex-col justify-between py-0.5 text-[10px] tabular-nums text-muted-foreground">
        <span>100</span>
        <span>50</span>
        <span>0</span>
      </div>
      <div className="flex-1">
        <div className="relative h-[200px]">
          {/* Gridlines at 0/50/100 */}
          {[0, 50, 100].map((g) => (
            <div
              key={g}
              className="absolute inset-x-0 border-t border-dashed border-border/60"
              style={{ top: `${100 - g}%` }}
            />
          ))}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full text-brand-1"
            aria-hidden
          >
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <polygon points={area} fill="url(#trendFill)" stroke="none" />
            <polyline
              points={line.join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{fullDay(data[0].date)}</span>
          {n > 1 && <span>{fullDay(data[n - 1].date)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Grouped daily-activity bars (questions vs quizzes) using flex/CSS heights. */
function ActivityBars({
  data,
}: {
  data: Array<{ date: string; questions: number; quizzes: number }>;
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.questions, d.quizzes]));
  const h = (v: number) => (v === 0 ? "0%" : `${Math.max((v / max) * 100, 6)}%`);

  return (
    <div className="flex h-[200px] items-end gap-1.5">
      {data.map((d) => (
        <div
          key={d.date}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <div className="flex h-full w-full items-end justify-center gap-0.5">
            <div
              className="w-1/2 max-w-[10px] rounded-t bg-brand-1"
              style={{ height: h(d.questions) }}
              title={`${fullDay(d.date)}: ${d.questions} questions`}
            />
            <div
              className="w-1/2 max-w-[10px] rounded-t bg-brand-3"
              style={{ height: h(d.quizzes) }}
              title={`${fullDay(d.date)}: ${d.quizzes} quizzes`}
            />
          </div>
          <span className="truncate text-[9px] text-muted-foreground">
            {shortDay(d.date)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/50" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />
      <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />
    </div>
  );
}
