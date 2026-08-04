// A proactive revision recommendation ("Practice Quiz — Deadlocks"). The
// reason line is mandatory product behavior: Aeva always explains *why* it
// recommends something ("You scored 58% 3 days ago").

import { motion } from "framer-motion";
import { ArrowRight, Layers, ListChecks, Sparkles } from "lucide-react";
import type { RevisionAction } from "@/types";

const ACTION_META: Record<
  RevisionAction,
  { label: string; icon: typeof Sparkles }
> = {
  review: { label: "Quick Revision", icon: Sparkles },
  quiz: { label: "Practice Quiz", icon: ListChecks },
  flashcards: { label: "Flashcards", icon: Layers },
};

export function RecommendationCard({
  action,
  topic,
  reason,
  index = 0,
  onClick,
}: {
  action: RevisionAction;
  topic: string;
  reason: string;
  index?: number;
  onClick: () => void;
}) {
  const meta = ACTION_META[action];
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className="glass group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-1/10 text-brand-1">
        <meta.icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {meta.label} · {topic}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {reason}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </motion.button>
  );
}
