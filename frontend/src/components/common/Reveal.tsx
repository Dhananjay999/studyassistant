import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Scroll-reveal wrapper. Animates once when it enters the viewport using only
 * transform/opacity (GPU-composited). Respects reduced-motion.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // Build-time prerender: emit fully visible content (no opacity:0 inline
  // style) so crawlers and no-JS visitors see the sections.
  const isServer = typeof window === "undefined";
  return (
    <motion.div
      className={className}
      initial={reduce || isServer ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
