// Admin overview: users-per-day timeline (7 to 90 days, as bars, lines or
// areas) and returning-user rates. Data comes from
// GET /admin/overview/engagement?days=N (migration 030).

import { lazy, Suspense, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AreaChart as AreaIcon,
  BarChart3,
  CalendarDays,
  LineChart as LineIcon,
  Repeat,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAdminEngagement } from "@/hooks/adminApi";
import { formatNumber } from "@/lib/adminFormat";
import type { AdminEngagement } from "@/types/admin";
import type { EngagementChartKind } from "./EngagementChart";

const EngagementChart = lazy(() => import("./EngagementChart"));

/** Range choices; the backend caps `days` at 90. */
const RANGES: { days: number; label: string; aria: string }[] = [
  { days: 7, label: "Week", aria: "Last 7 days" },
  { days: 14, label: "2 weeks", aria: "Last 14 days" },
  { days: 30, label: "Month", aria: "Last 30 days" },
  { days: 90, label: "Quarter", aria: "Last 90 days" },
];

const KINDS: { kind: EngagementChartKind; label: string; icon: typeof BarChart3 }[] = [
  { kind: "bar", label: "Bar chart", icon: BarChart3 },
  { kind: "line", label: "Line chart", icon: LineIcon },
  { kind: "area", label: "Area chart", icon: AreaIcon },
];

// Per-viewer convenience only: remembers the last range and chart kind.
const VIEW_KEY = "aeva_admin_engagement_view";

interface ViewPrefs {
  days: number;
  kind: EngagementChartKind;
}

const DEFAULT_VIEW: ViewPrefs = { days: 7, kind: "bar" };

function loadView(): ViewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewPrefs>;
    const days = RANGES.some((r) => r.days === parsed.days)
      ? (parsed.days as number)
      : DEFAULT_VIEW.days;
    const kind = KINDS.some((k) => k.kind === parsed.kind)
      ? (parsed.kind as EngagementChartKind)
      : DEFAULT_VIEW.kind;
    return { days, kind };
  } catch {
    return DEFAULT_VIEW;
  }
}

function saveView(view: ViewPrefs): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    /* private mode: the choice just does not persist */
  }
}

function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Repeat;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

function RateTile({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
      <p className="truncate text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-14" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      )}
      {!loading && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

function ChartFallback() {
  return <Skeleton className="h-[200px] w-full" />;
}

function Unavailable() {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      Engagement stats need database migration 030 (admin_engagement). Apply it
      and reload.
    </p>
  );
}

/** Range and chart-kind pickers. Items are 44px tall on touch screens. */
function ViewControls({
  view,
  onChange,
}: {
  view: ViewPrefs;
  onChange: (next: ViewPrefs) => void;
}) {
  const item =
    "h-11 min-w-11 whitespace-nowrap px-3 text-xs sm:h-9 sm:min-w-9 data-[state=on]:bg-primary/15 data-[state=on]:text-primary";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={String(view.days)}
        onValueChange={(v) => {
          if (v) onChange({ ...view, days: Number(v) });
        }}
        aria-label="Time range"
        className="flex-wrap justify-start gap-1"
      >
        {RANGES.map((r) => (
          <ToggleGroupItem
            key={r.days}
            value={String(r.days)}
            aria-label={r.aria}
            className={item}
          >
            {r.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={view.kind}
        onValueChange={(v) => {
          if (v) onChange({ ...view, kind: v as EngagementChartKind });
        }}
        aria-label="Chart type"
        className="flex-wrap justify-start gap-1"
      >
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <ToggleGroupItem
            key={kind}
            value={kind}
            aria-label={label}
            title={label}
            className={item}
          >
            <Icon className="h-4 w-4" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function EngagementPanel() {
  const [view, setView] = useState<ViewPrefs>(loadView);
  const { data, isLoading, isError, isFetching, error } = useAdminEngagement(
    view.days,
  );
  const reduceMotion = useReducedMotion();

  const changeView = (next: ViewPrefs) => {
    setView(next);
    saveView(next);
  };

  const enter = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const unavailable = !isLoading && data && !data.available;
  const retention = data?.retention;
  const win = data?.window;
  // Range the loaded data covers (lags `view.days` while a new range loads).
  const days = data?.days ?? view.days;

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <motion.div
        {...enter}
        transition={{ duration: 0.2, delay: 0.3 }}
        className="min-w-0 lg:col-span-3"
      >
        <Card className="space-y-3 p-4">
          <SectionTitle
            icon={CalendarDays}
            title="Users per day"
            hint={`Last ${view.days} days · active vs new sign-ups (UTC)`}
          />
          <ViewControls view={view} onChange={changeView} />
          {isError ? (
            <p className="text-sm text-destructive">
              {error instanceof Error
                ? error.message
                : "Failed to load engagement."}
            </p>
          ) : unavailable ? (
            <Unavailable />
          ) : isLoading || !data ? (
            <ChartFallback />
          ) : (
            <Suspense fallback={<ChartFallback />}>
              <div
                className="transition-opacity duration-200"
                style={{ opacity: isFetching ? 0.6 : 1 }}
                aria-busy={isFetching}
              >
                <EngagementChart
                  data={data.daily}
                  kind={view.kind}
                  days={days}
                />
              </div>
            </Suspense>
          )}
          {win && data?.available && (
            <p className="text-xs text-muted-foreground">
              {formatNumber(win.active_users)} active in the last {days} days:{" "}
              {formatNumber(win.returning_users)} returning (signed up before
              the window), {formatNumber(win.new_users)} new.
            </p>
          )}
        </Card>
      </motion.div>

      <motion.div
        {...enter}
        transition={{ duration: 0.2, delay: 0.33 }}
        className="min-w-0 lg:col-span-2"
      >
        <Card className="space-y-3 p-4">
          <SectionTitle
            icon={Repeat}
            title="Returning rate"
            hint={`Users who signed up in the last ${
              retention?.cohort_days ?? Math.max(30, view.days)
            } days and came back on a later day`}
          />
          {unavailable ? (
            <Unavailable />
          ) : (
            <RetentionTiles
              retention={retention}
              win={win}
              days={days}
              loading={isLoading || !data}
            />
          )}
        </Card>
      </motion.div>
    </div>
  );
}

function RetentionTiles({
  retention,
  win,
  days,
  loading,
}: {
  retention: AdminEngagement["retention"] | undefined;
  win: AdminEngagement["window"] | undefined;
  days: number;
  loading: boolean;
}) {
  const size = retention?.cohort_size ?? 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <RateTile
        label="Ever returned"
        value={pct(retention?.returned_any_rate)}
        detail={`${formatNumber(retention?.returned_any)} of ${formatNumber(size)} sign-ups`}
        loading={loading}
      />
      <RateTile
        label="Next day"
        value={pct(retention?.d1_rate)}
        detail={`${formatNumber(retention?.returned_d1)} of ${formatNumber(size)} came back day 1`}
        loading={loading}
      />
      <RateTile
        label="Within 7 days"
        value={pct(retention?.d7_rate)}
        detail={`${formatNumber(retention?.returned_d7)} of ${formatNumber(
          retention?.eligible_d7,
        )} eligible`}
        loading={loading}
      />
      <RateTile
        label="Returning share"
        value={pct(win?.returning_rate)}
        detail={`${formatNumber(win?.returning_users)} of ${formatNumber(
          win?.active_users,
        )} active in ${days} days`}
        loading={loading}
      />
    </div>
  );
}
