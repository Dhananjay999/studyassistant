// The tappable status indicator of a topic: a 44px target that cycles
// not started → in progress → completed. The icon morphs with a short
// scale/fade so the change reads as a state transition.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Circle, Loader2, Play } from "lucide-react";
import { STATUS_LABEL, STATUS_TONE, nextStatus } from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamTopicStatus } from "@/types";

export function TopicStatusDot({
  status,
  busy,
  onClick,
  className,
}: {
  status: ExamTopicStatus;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const tone = STATUS_TONE[status];
  const Icon =
    status === "completed" ? Check : status === "in_progress" ? Play : Circle;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`${STATUS_LABEL[status]}. Mark as ${STATUS_LABEL[nextStatus(status)].toLowerCase()}`}
      data-analytics-name="Exam topic status"
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors active:scale-95",
        className,
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-full border-2 transition-colors",
          tone.ring,
          tone.bg,
          tone.text,
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={status}
              initial={reduce ? false : { scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? undefined : { scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="grid place-items-center"
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  status === "in_progress" && "ml-0.5 fill-current",
                  status === "not_started" && "opacity-0",
                )}
              />
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    </button>
  );
}
