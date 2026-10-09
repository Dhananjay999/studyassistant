import { ArrowRight, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/common/AuroraBackground";
import { analyticsAttrs } from "@/lib/analytics";
import { RotatingWords } from "@/components/common/RotatingWords";
import { Marquee } from "@/components/common/Marquee";
import { GoogleButton } from "@/components/landing/GoogleButton";
import { HeroDemo } from "@/components/landing/HeroDemo";
import "./hero.css";

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

// Entrance animation is pure CSS (hero.css): transform + opacity keyframes
// that start playing from the prerendered HTML, before any JavaScript, so
// framer-motion is not needed to paint the hero and the main thread is free
// for hydration (mobile LCP/INP). `hero-enter-N` picks the stagger step; the
// classes are inert under prefers-reduced-motion and the in-app toggle.
const enter = (step: 0 | 1 | 2 | 3 | 4) => `hero-enter hero-enter-${step}`;

export function Hero() {
  return (
    <section
      id="top"
      data-landing-section="hero"
      aria-labelledby="hero-heading"
      className="relative overflow-hidden pt-32 md:pt-40"
    >
      <AuroraBackground />
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <span
            className={`${enter(0)} inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs font-medium text-muted-foreground`}
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-1" aria-hidden="true" />
            Meet Aeva — your AI study buddy
          </span>

          {/* The LCP element: rendered statically (no entrance animation) so
              it paints as soon as HTML + fonts are available. */}
          <h1
            id="hero-heading"
            className="mt-5 font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl"
          >
            Your <span className="text-gradient">AI study assistant</span>
            <br className="hidden sm:block" /> for every subject
          </h1>

          <p
            className={`${enter(1)} mt-4 font-display text-xl font-bold text-muted-foreground sm:text-2xl`}
          >
            Study smarter for <RotatingWords words={SUBJECTS} />
          </p>

          <p
            className={`${enter(2)} mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg`}
          >
            StudyAssistant helps with homework, exam prep, and everyday
            learning: chat with your PDFs and notes, search the web, and turn
            any answer into flashcards, quizzes, and notes — then Aeva
            remembers what you studied and tells you exactly what to revise.
            Exam coming up? Aeva plans every day and teaches every topic.
          </p>

          <div
            className={`${enter(3)} mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row`}
          >
            <GoogleButton label="Start learning free" location="hero" />
            <a
              href="#features"
              {...analyticsAttrs(
                "landing.hero.explore_features",
                "Explore features",
                "hero",
              )}
              className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Explore features <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className={`${enter(4)} mx-auto mt-14 max-w-3xl`}>
          <HeroDemo />
        </div>

        <div className="mt-12 pb-4">
          <Marquee items={SUBJECTS} />
        </div>
      </div>
    </section>
  );
}
