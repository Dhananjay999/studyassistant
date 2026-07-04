import { motion } from "framer-motion";
import { ArrowRight, Bot, FileText, Layers, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/common/AuroraBackground";
import { RotatingWords } from "@/components/common/RotatingWords";
import { Marquee } from "@/components/common/Marquee";
import { GlassCard } from "@/components/common/GlassCard";
import { GoogleButton } from "@/components/landing/GoogleButton";

const SUBJECTS = [
  "Biology",
  "Calculus",
  "History",
  "Physics",
  "Chemistry",
  "Economics",
  "Literature",
  "Computer Science",
];

// Build-time prerender: skip entrance animations so static HTML is fully
// visible (no opacity:0 inline styles) for crawlers and no-JS visitors.
const IS_SERVER = typeof window === "undefined";

function entrance(delay: number) {
  return {
    initial: IS_SERVER ? false : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay },
  } as const;
}

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-heading" className="relative overflow-hidden pt-32 md:pt-40">
      <AuroraBackground />
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <motion.span
            {...entrance(0)}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs font-medium text-muted-foreground"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-1" aria-hidden="true" />
            Meet Aeva — your AI study buddy
          </motion.span>

          {/* The LCP element: rendered statically (no entrance animation) so
              it paints as soon as HTML + fonts are available. */}
          <h1
            id="hero-heading"
            className="mt-5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl"
          >
            Your <span className="text-gradient">AI study assistant</span>
            <br className="hidden sm:block" /> for every subject
          </h1>

          <motion.p
            {...entrance(0.05)}
            className="mt-4 font-display text-xl font-bold text-muted-foreground sm:text-2xl"
          >
            Study smarter for <RotatingWords words={SUBJECTS} />
          </motion.p>

          <motion.p
            {...entrance(0.12)}
            className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg"
          >
            StudyAssistant helps with homework, exam prep, and everyday
            learning: chat with your PDFs and notes, search the web, and turn
            any answer into flashcards, practice quizzes, and study plans — a
            complete AI learning platform, not just a chatbot.
          </motion.p>

          <motion.div
            {...entrance(0.18)}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <GoogleButton label="Start learning free" />
            <a
              href="#features"
              className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Explore features <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </motion.div>
        </div>

        <motion.div
          {...entrance(0.25)}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="mx-auto mt-14 max-w-3xl"
        >
          <HeroPreview />
        </motion.div>

        <div className="mt-12 pb-4">
          <Marquee items={SUBJECTS} />
        </div>
      </div>
    </section>
  );
}

/** Decorative mock of a chat exchange — hidden from assistive tech. */
function HeroPreview() {
  return (
    <GlassCard
      strong
      aria-hidden="true"
      className="animate-float p-4 shadow-glow-lg sm:p-6"
      style={{ animationDuration: "7s" }}
    >
      <div className="space-y-4 text-left">
        <div className="flex justify-end">
          <span className="rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
            Explain how a B-tree index works
          </span>
        </div>
        <div className="flex gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
            <Bot className="h-4 w-4" />
          </span>
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted/70 px-4 py-3 text-sm leading-relaxed">
            A B-tree index keeps data sorted in a balanced tree so lookups stay
            fast even on huge tables…
            <span className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-1/40 px-2.5 py-1 text-xs font-medium text-brand-1">
                <Sparkles className="h-3 w-3" /> Create Quiz
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-1/40 px-2.5 py-1 text-xs font-medium text-brand-1">
                <Layers className="h-3 w-3" /> Create Flashcards
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground">
                <FileText className="h-3 w-3" /> 2 sources
              </span>
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
