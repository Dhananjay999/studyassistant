import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BrandLogo } from "@/components/common/BrandLogo";

const SEEN_KEY = "aeva_intro_seen";

/**
 * Full-screen brand reveal shown once per session (sessionStorage), then fades
 * out and calls onDone. Skipped entirely under reduced-motion / if already seen.
 */
export function IntroLoader({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(() => {
    if (reduce) return false;
    try {
      return !sessionStorage.getItem(SEEN_KEY);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!show) {
      onDone();
      return;
    }
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(() => setShow(false), 1700);
    return () => window.clearTimeout(id);
  }, [show, onDone]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          <div className="relative">
            <motion.div
              className="absolute -inset-10 rounded-full bg-brand-gradient opacity-30 blur-3xl"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1.1, opacity: 0.35 }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <BrandLogo className="scale-150" />
            </motion.div>
            <motion.div
              className="mx-auto mt-8 h-1 w-40 overflow-hidden rounded-full bg-muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <motion.div
                className="h-full w-full bg-brand-gradient"
                initial={{ x: "-100%" }}
                animate={{ x: "0%" }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
