// A dismissible three-step explainer above "Next up", shown only until the
// student completes their first topic. Dismissal is remembered per plan in
// localStorage (reads and writes are guarded: storage may be unavailable).

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";

export const HOW_IT_WORKS_DISMISSED_KEY = "aeva.examPrep.howItWorksDismissed.v1";

const STEPS: { n: number; title: string; text: string }[] = [
  { n: 1, title: "Learn", text: "open a topic and read Aeva's lesson" },
  { n: 2, title: "Practice", text: "quiz and flashcards" },
  { n: 3, title: "Mark done", text: "Aeva takes you to the next topic" },
];

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(HOW_IT_WORKS_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(planId: string): void {
  try {
    window.localStorage.setItem(HOW_IT_WORKS_DISMISSED_KEY, planId);
  } catch {
    // Storage unavailable: the strip simply shows again next visit.
  }
}

export function HowItWorksStrip({ planId }: { planId: string }) {
  const reduce = useReducedMotion();
  const [dismissed, setDismissed] = useState(() => readDismissed() === planId);

  const dismiss = () => {
    writeDismissed(planId);
    setDismissed(true);
  };

  return (
    <AnimatePresence initial={false}>
      {!dismissed && (
        <motion.div
          key="how-it-works"
          initial={false}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeIn" }}
        >
          <GlassCard className="relative p-4 pr-12">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              How it works
            </p>
            <ol className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
              {STEPS.map((s) => (
                <li key={s.n} className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-1/10 text-xs font-bold text-brand-1 tabular-nums">
                    {s.n}
                  </span>
                  <span className="min-w-0 text-sm leading-snug">
                    <span className="font-semibold">{s.title}</span>
                    <span className="text-muted-foreground"> — {s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismiss}
              data-analytics-name="Exam how it works dismiss"
              className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
