// Post-session confidence check-in ("How confident do you feel now?").
// The answer feeds the spaced-repetition schedule: confused resets the
// topic's interval, mastered fast-tracks it. Self-contained — errors toast
// and re-enable, success morphs into a confirmation, and it never blocks
// the actions around it.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/common/GlassCard";
import { useSubmitConfidence } from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { ConfidenceInput, ConfidenceLevel } from "@/types";

const LEVELS: Array<{
  value: ConfidenceLevel;
  emoji: string;
  label: string;
  cls: string;
}> = [
  {
    value: "confused",
    emoji: "😕",
    label: "Still confused",
    cls: "border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
  },
  {
    value: "better",
    emoji: "🙂",
    label: "Better",
    cls: "border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
  },
  {
    value: "mastered",
    emoji: "😎",
    label: "Mastered",
    cls: "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
  },
];

interface ConfidencePromptProps {
  topic: string;
  source: ConfidenceInput["source"];
  refId?: string;
  className?: string;
}

export function ConfidencePrompt({
  topic,
  source,
  refId,
  className,
}: ConfidencePromptProps) {
  const submit = useSubmitConfidence();
  const [done, setDone] = useState<ConfidenceLevel | null>(null);

  const pick = async (confidence: ConfidenceLevel) => {
    try {
      await submit.mutateAsync({ topic, confidence, source, ref_id: refId });
      setDone(confidence);
    } catch {
      toast.error("Couldn't save that — try again?");
    }
  };

  return (
    <GlassCard className={cn("border-brand-1/20 p-4", className)}>
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-2 py-1 text-sm"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              Noted — your revision schedule for{" "}
              <span className="font-medium">{topic}</span> is updated.
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="ask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <p className="text-center text-sm font-medium">
              How confident do you feel about{" "}
              <span className="text-brand-1">{topic}</span>?
            </p>
            <div className="mt-3 flex justify-center gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => pick(l.value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border bg-transparent px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                    l.cls,
                  )}
                >
                  <span aria-hidden>{l.emoji}</span>
                  {l.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
