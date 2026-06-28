import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { APP_BOOT_MESSAGES } from "@/lib/loadingMessages";

/**
 * Warm, AI-first full-screen loader: a breathing brand mark, a soft pulse
 * ring, rotating status copy, and a subtle three-dot animation — no spinner,
 * no skeletons.
 */
export function AppLoader({
  messages = APP_BOOT_MESSAGES,
  aurora = false,
}: {
  messages?: string[];
  /** Adds an animated gradient backdrop (used for the auth handoff). */
  aurora?: boolean;
}) {
  return (
    <div className="relative grid h-dvh place-items-center overflow-hidden bg-background px-6">
      {aurora && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 animate-gradient-pan bg-brand-gradient bg-[length:200%_200%] opacity-[0.10]" />
          <div className="absolute -left-24 top-1/4 h-72 w-72 animate-float rounded-full bg-brand-1/20 blur-3xl" />
          <div className="absolute -right-20 bottom-1/4 h-72 w-72 animate-float-slow rounded-full bg-brand-3/20 blur-3xl" />
        </div>
      )}
      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <motion.span
          className="relative grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient shadow-glow"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-8 w-8 text-white" />
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-2xl ring-2 ring-brand-1/40"
            animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.4, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.span>

        <div className="mt-7 h-5 text-sm font-medium text-muted-foreground">
          <RotatingStatus messages={messages} intervalMs={2400} />
        </div>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-brand-1"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{
                duration: 1.1,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.18,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
