import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import {
  THINKING_PROGRESSIONS,
  type ThinkingHint,
} from "@/lib/loadingMessages";

/**
 * Gemini-style "thinking" state. Messages advance on a *progressive* cadence
 * (0s → 2s → 5s → 8s → 12s) rather than rapid switching, so longer waits feel
 * intentional. Paired with shimmering skeleton lines.
 */
export function ThinkingIndicator({ hint }: { hint?: ThinkingHint }) {
  const steps = THINKING_PROGRESSIONS[hint ?? "thinking"];
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    if (reduce) return undefined;
    const timers = steps
      .slice(1)
      .map((s, i) =>
        window.setTimeout(() => setStep(i + 1), s.at),
      );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [steps, reduce]);

  return (
    <div className="space-y-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-1/10 px-2.5 py-1 text-xs font-medium text-brand-1">
        <Sparkles className="h-3 w-3 animate-pulse" />
        <span className="relative inline-block">
          <AnimatePresence mode="wait">
            <motion.span
              key={step}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -6, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block"
            >
              {steps[step].text}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
      <div className="space-y-2">
        {[92, 78, 64].map((w) => (
          <div
            key={w}
            style={{ width: `${w}%` }}
            className="motion-loop h-3 animate-shimmer rounded-full bg-gradient-to-r from-muted via-muted/30 to-muted bg-[length:200%_100%]"
          />
        ))}
      </div>
    </div>
  );
}
