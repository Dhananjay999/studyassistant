// Daily active / new users chart for the admin overview, drawn as bars, lines
// or areas. Lazy-loaded by EngagementPanel so Recharts stays out of the admin
// panel's first chunk.

import { useReducedMotion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdminEngagementDay } from "@/types/admin";

export type EngagementChartKind = "bar" | "line" | "area";

// Fixed series order and colours: "active" is always violet, "new" always
// teal, whatever the data or chart kind.
const config = {
  active_users: { label: "Active", color: "hsl(var(--brand-1))" },
  new_users: { label: "New", color: "hsl(var(--brand-4))" },
} satisfies ChartConfig;

const SERIES = ["active_users", "new_users"] as const;

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function weekday(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}

function dayMonth(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function fullDay(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const ANIMATION_MS = 250;

export default function EngagementChart({
  data,
  kind,
  days,
}: {
  data: AdminEngagementDay[];
  kind: EngagementChartKind;
  days: number;
}) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;
  // A week reads best by weekday; anything longer needs the date.
  const tick = days <= 7 ? weekday : dayMonth;

  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="4 4" />
      <XAxis
        dataKey="day"
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={days <= 7 ? 0 : 28}
        tickFormatter={(v) => tick(v as string)}
      />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
      <ChartTooltip
        cursor={
          kind === "bar"
            ? { fillOpacity: 0.4 }
            : { stroke: "hsl(var(--brand-1))", strokeOpacity: 0.35 }
        }
        content={
          <ChartTooltipContent
            labelFormatter={(_, payload) =>
              fullDay((payload?.[0]?.payload as AdminEngagementDay)?.day)
            }
          />
        }
      />
      <ChartLegend content={<ChartLegendContent />} />
    </>
  );

  const margin = { top: 8, right: 4, left: -16, bottom: 0 };

  return (
    <ChartContainer config={config} className="h-[200px] w-full !aspect-auto">
      {kind === "bar" ? (
        <BarChart data={data} margin={margin} barCategoryGap="28%" barGap={2}>
          {axes}
          {SERIES.map((key) => (
            <Bar
              key={key}
              dataKey={key}
              fill={`var(--color-${key})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={animate}
              animationDuration={ANIMATION_MS}
            />
          ))}
        </BarChart>
      ) : kind === "line" ? (
        <LineChart data={data} margin={margin}>
          {axes}
          {SERIES.map((key) => (
            <Line
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={data.length <= 14 ? { r: 3, strokeWidth: 0 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={animate}
              animationDuration={ANIMATION_MS}
            />
          ))}
        </LineChart>
      ) : (
        <AreaChart data={data} margin={margin}>
          <defs>
            {SERIES.map((key) => (
              <linearGradient
                key={key}
                id={`engagement-fill-${key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={`var(--color-${key})`}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={`var(--color-${key})`}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          {axes}
          {SERIES.map((key) => (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              fill={`url(#engagement-fill-${key})`}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={animate}
              animationDuration={ANIMATION_MS}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  );
}
