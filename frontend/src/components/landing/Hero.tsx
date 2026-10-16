import { ArrowRight, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/common/AuroraBackground";
import { analyticsAttrs } from "@/lib/analytics";
import { requestAuthPrompt } from "@/lib/authPrompt";
import { LANDING_HERO_EXPERIMENT } from "@/lib/experiments";
import { useExperimentVariant } from "@/hooks/useExperimentVariant";
import { useAuth } from "@/contexts/AuthContext";
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

// landing-hero-v2 test variant: a first action that is not "hand over your
// Google account" — three things a student would actually type. A tap opens
// the sign-in prompt with chip-specific copy (or starts sign-in directly when
// the prompt has been dismissed on this device).
const HERO_PROMPTS = [
  "Explain photosynthesis like I'm in class 10",
  "Make a quiz from my chapter notes",
  "Plan my revision for an exam next week",
];

function HeroPrompts() {
  const { signInWithGoogle, signingIn } = useAuth();
  const pick = () => {
    if (!requestAuthPrompt("hero_chip")) signInWithGoogle();
  };
  return (
    <ul
      className="mt-6 flex flex-wrap items-center justify-center gap-2"
      aria-label="Try asking Aeva"
    >
      {HERO_PROMPTS.map((text) => (
        <li key={text}>
          <button
            type="button"
            disabled={signingIn}
            onClick={pick}
            {...analyticsAttrs(
              "landing.hero.prompt_chip",
              "Hero prompt chip",
              "hero",
            )}
            className="glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-left text-sm transition-colors hover:border-primary/30 hover:shadow-sm active:scale-[0.98] disabled:opacity-70"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-1" aria-hidden="true" />
            <span>{text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Hero() {
  // Control until flags load (and always in the prerendered HTML).
  const test = useExperimentVariant(LANDING_HERO_EXPERIMENT) === "test";
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
            {test ? (
              <>
                Chat with your notes and PDFs, turn any answer into a quiz or
                flashcards, and get a day-by-day plan for your next exam.
              </>
            ) : (
              <>
                StudyAssistant helps with homework, exam prep, and everyday
                learning: chat with your PDFs and notes, search the web, and
                turn any answer into flashcards, quizzes, and notes — then Aeva
                remembers what you studied and tells you exactly what to revise.
                Exam coming up? Aeva plans every day and teaches every topic.
              </>
            )}
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

          {test && <HeroPrompts />}
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
