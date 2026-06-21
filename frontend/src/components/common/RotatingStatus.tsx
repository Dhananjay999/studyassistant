import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Cycles short status lines with a soft fade/slide. The shared animation
 * language for AI-style loaders (boot screen, thinking states, etc.).
 */
export function RotatingStatus({
  messages,
  intervalMs = 2200,
  className,
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce || messages.length <= 1) return undefined;
    const id = window.setInterval(
      () => setI((p) => (p + 1) % messages.length),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [reduce, messages.length, intervalMs]);

  if (reduce) {
    return <span className={className}>{messages[0]}</span>;
  }

  return (
    <span className={cn("relative inline-block", className)}>
      <AnimatePresence mode="wait">
        <motion.span
          key={messages[i]}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -6, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {messages[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
