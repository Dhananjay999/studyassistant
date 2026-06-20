import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * Cycles a list of words in place (vertical slide). Under reduced-motion it
 * just shows the first word.
 */
export function RotatingWords({
  words,
  intervalMs = 2200,
  className,
}: {
  words: string[];
  intervalMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduce || words.length <= 1) return;
    const id = window.setInterval(
      () => setI((p) => (p + 1) % words.length),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [reduce, words.length, intervalMs]);

  if (reduce) {
    return <span className={className}>{words[0]}</span>;
  }

  return (
    <span className={`relative inline-grid ${className ?? ""}`}>
      {/* Invisible widest word reserves height/width to avoid layout shift. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {words.reduce((a, b) => (a.length >= b.length ? a : b), "")}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={words[i]}
          className="col-start-1 row-start-1 text-gradient"
          initial={{ y: "0.6em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.6em", opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
