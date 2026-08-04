// One topic on the revision dashboard: name, recency/due metadata, memory
// strength, the reason it's listed (always visible — recommendations must
// explain themselves), and the study actions. The recommended action gets
// the brand treatment so the suggested next step is obvious at a glance.

import { motion } from "framer-motion";
import { Layers, ListChecks, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useRevisionActions } from "@/hooks/useRevisionActions";
import { dueLabel, lastStudied } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import type { RevisionAction, RevisionTopicItem } from "@/types";

function strengthTone(pct: number): string {
  if (pct < 40) return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (pct < 70) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
}

export function RevisionTopicRow({
  item,
  index = 0,
}: {
  item: RevisionTopicItem;
  index?: number;
}) {
  const actions = useRevisionActions();
  const target = {
    topic: item.topic,
    quiz_id: item.sources.quiz_id,
    set_id: item.sources.set_id,
    space_id: item.space_id,
  };
  const pct = item.max_strength
    ? Math.round((item.strength / item.max_strength) * 100)
    : 0;

  const buttons: Array<{
    action: RevisionAction;
    label: string;
    icon: typeof Sparkles;
    onClick: () => void;
  }> = [
    {
      action: "review",
      label: "Revise",
      icon: Sparkles,
      onClick: () => actions.revise(target),
    },
    {
      action: "quiz",
      label: "Quiz",
      icon: ListChecks,
      onClick: () => actions.quiz(target),
    },
    {
      action: "flashcards",
      label: "Flashcards",
      icon: Layers,
      onClick: () => actions.flashcards(target),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.3) }}
    >
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-display font-bold">{item.topic}</p>
              <Badge
                variant="outline"
                className={cn("border-0 tabular-nums", strengthTone(pct))}
              >
                {pct}%
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.last_reviewed_at
                ? `Studied ${lastStudied(item.last_reviewed_at)}`
                : "Not studied yet"}
              {item.due_at
                ? ` · ${dueLabel(item.due_at, item.overdue_days)}`
                : ""}
            </p>
            <Progress value={pct} className="mt-2 h-1.5 max-w-56" />
            <p className="mt-2 text-xs text-muted-foreground">
              {item.reason}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {buttons.map((b) => {
              const primary = b.action === item.recommended_action;
              return (
                <Button
                  key={b.action}
                  size="sm"
                  variant={primary ? "brand" : "outline"}
                  disabled={actions.pending}
                  onClick={b.onClick}
                  className="gap-1.5"
                >
                  <b.icon className="h-3.5 w-3.5" />
                  {b.label}
                </Button>
              );
            })}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
