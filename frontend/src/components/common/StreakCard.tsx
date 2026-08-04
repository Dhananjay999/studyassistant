// Study-streak banner shared by the Analytics and Revision dashboards —
// extracted so both surfaces show the identical streak treatment.

import { Flame } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { cn } from "@/lib/utils";

interface StreakCardProps {
  streak: number;
  /** Line under the count; defaults to the analytics phrasing. */
  subtitle?: string;
  className?: string;
}

export function StreakCard({ streak, subtitle, className }: StreakCardProps) {
  return (
    <GlassCard
      className={cn("flex items-center gap-4 bg-brand-1/5 p-5", className)}
    >
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
          {subtitle ??
            (streak > 0
              ? "Study streak — keep the momentum going!"
              : "Ask a question or take a quiz to start a streak.")}
        </p>
      </div>
    </GlassCard>
  );
}
