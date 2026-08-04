import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/common/AuroraBackground";
import { RotatingWords } from "@/components/common/RotatingWords";
import { Marquee } from "@/components/common/Marquee";
import { GoogleButton } from "@/components/landing/GoogleButton";
import { HeroDemo } from "@/components/landing/HeroDemo";

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
          <HeroDemo />
        </motion.div>

        <div className="mt-12 pb-4">
          <Marquee items={SUBJECTS} />
        </div>
      </div>
    </section>
  );
}
