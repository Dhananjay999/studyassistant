import { Loader2 } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder card shown at the top of a library grid while a quiz / deck
 * created from that page is still being generated. */
export function PendingCreationCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <GlassCard
      className="flex h-full min-h-40 flex-col border-primary/30 p-4"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <h3 className="font-display text-base font-bold">{title}</h3>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="mt-auto h-9 w-full" />
    </GlassCard>
  );
}
