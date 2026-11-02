// Full-screen "Building your plan…" state shown while the backend generates
// a roadmap (one to two minutes). Same look as the setup form's building
// phase so editing a plan feels like the flow the student already knows.

import { Loader2, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { cn } from "@/lib/utils";

const RESEARCH_MESSAGE = "Researching the official syllabus and exam pattern…";
const BUILD_MESSAGES = [
  "Reading your subjects and dates…",
  "Spreading topics across your days…",
  "Keeping the topics you've already done…",
  "Adding revision and mock-test days…",
  "Almost there — polishing the plan…",
];

export function PlanBuildingScreen({
  title = "Building your plan…",
  research = false,
  className,
}: {
  title?: string;
  /** The syllabus is being researched online first (adds about a minute). */
  research?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background px-6 text-center",
        className,
      )}
    >
      <motion.span
        initial={reduce ? false : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-1 to-brand-2 text-white shadow-glow-lg"
      >
        <Sparkles className="h-9 w-9" />
      </motion.span>
      <div>
        <h2 className="font-display text-2xl font-extrabold">{title}</h2>
        <p className="mt-2 min-h-[1.5rem] text-sm text-muted-foreground">
          <RotatingStatus
            messages={research ? [RESEARCH_MESSAGE, ...BUILD_MESSAGES] : BUILD_MESSAGES}
            intervalMs={3200}
          />
        </p>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
        {research ? "Usually one to two minutes." : "This usually takes under a minute."}
      </p>
    </div>
  );
}
