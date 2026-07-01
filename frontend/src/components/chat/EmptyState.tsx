import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useLearningProfile } from "@/hooks/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildSuggestedPrompts } from "@/lib/suggestedPrompts";

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const reduce = useReducedMotion();
  const isMobile = useIsMobile();
  const { data: profile, isLoading } = useLearningProfile();
  const count = isMobile ? 4 : 6;

  // Re-rolled per mount (opening a new chat) so combinations stay fresh.
  // Building only once the profile has resolved keeps the set from flickering
  // (generic → personalized) — while loading we show a skeleton instead.
  const prompts = useMemo(
    () => buildSuggestedPrompts(profile, count),
    [profile, count],
  );

  return (
    <div className="relative mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      {/* Subtle animated aurora backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/2 top-1/4 h-64 w-64 -translate-x-1/2 animate-float rounded-full bg-brand-1/15 blur-3xl" />
        <div className="absolute bottom-10 right-8 h-48 w-48 animate-float-slow rounded-full bg-brand-3/15 blur-3xl" />
        <div className="absolute bottom-16 left-6 h-40 w-40 animate-float rounded-full bg-brand-4/10 blur-3xl" />
      </div>

      {/* AI pulse brand mark */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <motion.span
          className="relative grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient shadow-glow"
          animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-8 w-8 text-white" />
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-2xl ring-2 ring-brand-1/40"
            animate={
              reduce ? undefined : { opacity: [0.6, 0, 0.6], scale: [1, 1.5, 1] }
            }
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.5 }}
      >
        <h2 className="text-gradient animate-gradient-pan bg-[length:200%_auto] font-display text-3xl font-bold">
          Ask Aeva anything
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask a question, attach your notes, or generate a quiz.
        </p>
      </motion.div>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {isLoading
          ? Array.from({ length: count }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                style={{ width: isMobile ? "100%" : `${64 + ((i * 13) % 24)}%` }}
                className="glass flex h-11 items-center gap-2 rounded-xl px-4 sm:w-auto sm:min-w-[13rem] sm:flex-1 sm:basis-[13rem]"
              >
                <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted-foreground/25" />
                <span className="h-3 flex-1 animate-pulse rounded bg-muted-foreground/20" />
              </div>
            ))
          : prompts.map((p, i) => (
              <motion.button
                key={p.text}
                type="button"
                onClick={() => onPick(p.text)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-transform hover:-translate-y-0.5 hover:shadow-glow"
              >
                <p.icon className="h-4 w-4 shrink-0 text-brand-1" />
                {p.text}
              </motion.button>
            ))}
      </div>
    </div>
  );
}
