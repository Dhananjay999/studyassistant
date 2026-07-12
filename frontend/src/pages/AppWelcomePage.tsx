import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { Button } from "@/components/ui/button";
import { Seo } from "@/components/common/Seo";
import { useAuth } from "@/contexts/AuthContext";
import { useSwipe } from "@/hooks/useSwipe";
import { hasSeenAppOnboarding, markAppOnboardingSeen } from "@/lib/appMode";
import { cn } from "@/lib/utils";

/**
 * Native-app entry (WebView, `is_open_from_app`): replaces the marketing
 * landing page with an app-style flow — a one-time swipeable onboarding, then
 * a minimal welcome/login screen. Mobile-first, safe-area aware.
 */

const SLIDES: { emoji: string; title: string; description: string }[] = [
  {
    emoji: "🧠",
    title: "Learn with your personal AI tutor",
    description:
      "Ask anything and get clear, personalized explanations from Aeva — anytime, on any subject.",
  },
  {
    emoji: "📄",
    title: "Upload PDFs and chat with your notes",
    description:
      "Your study material becomes a conversation. Ask questions and get answers grounded in your files.",
  },
  {
    emoji: "📝",
    title: "Generate quizzes instantly",
    description:
      "Turn any topic or document into a practice quiz in seconds — with difficulty you control.",
  },
  {
    emoji: "🃏",
    title: "Create flashcards and revise smarter",
    description:
      "Auto-generated decks help you review the right things at the right time.",
  },
  {
    emoji: "📈",
    title: "Track your learning progress",
    description:
      "See your strengths, spot weak areas, and watch your scores grow over time.",
  },
];

function Onboarding({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(1);
  const last = SLIDES.length - 1;

  const go = (next: number) => {
    if (next < 0 || next > last) return;
    setDir(next > page ? 1 : -1);
    setPage(next);
  };

  const swipe = useSwipe({
    onSwipeLeft: () => go(page + 1),
    onSwipeRight: () => go(page - 1),
  });

  const slide = SLIDES[page];

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-background to-muted/40 pt-safe pb-safe">
      {/* Skip */}
      <div className="flex justify-end px-5 pt-4">
        {page < last ? (
          <button
            type="button"
            onClick={onDone}
            className="touch-target rounded-full px-3 text-sm font-medium text-muted-foreground"
          >
            Skip
          </button>
        ) : (
          <span className="touch-target px-3" aria-hidden="true" />
        )}
      </div>

      {/* Slide */}
      <div
        className="flex flex-1 flex-col items-center justify-center overflow-hidden px-8 text-center"
        {...swipe}
      >
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={page}
            initial={{ opacity: 0, x: dir * 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -48 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="flex flex-col items-center"
          >
            <div className="grid h-28 w-28 place-items-center rounded-[2rem] bg-brand-1/10 text-6xl shadow-glow">
              <span role="img" aria-hidden="true">
                {slide.emoji}
              </span>
            </div>
            <h1 className="mt-8 font-display text-2xl font-bold leading-snug">
              {slide.title}
            </h1>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {slide.description}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Indicator + actions */}
      <div className="space-y-5 px-6 pb-6">
        <div className="flex justify-center gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`Go to page ${i + 1}`}
              onClick={() => go(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === page ? "w-6 bg-brand-1" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
        {page < last ? (
          <Button
            onClick={() => go(page + 1)}
            className="h-12 w-full gap-1.5 rounded-xl bg-brand-gradient text-base text-white shadow-glow"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={onDone}
            className="h-12 w-full rounded-xl bg-brand-gradient text-base text-white shadow-glow"
          >
            Get Started
          </Button>
        )}
      </div>
    </div>
  );
}

function Welcome() {
  const { signInWithGoogle, signingIn } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-background to-muted/40 pt-safe pb-safe">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-gradient shadow-glow"
        >
          <Sparkles className="h-10 w-10 text-white" />
        </motion.div>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">
          StudyAssistant
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your personal AI study buddy — learn, quiz, and revise smarter.
        </p>
      </div>

      <div className="space-y-3 px-6 pb-8">
        {/* Clean, standard full-width Google button (the landing page's
           animated-gradient pill doesn't stretch well on mobile). */}
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={signingIn}
          className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-border bg-card text-base font-semibold shadow-sm transition-transform active:scale-[0.98] disabled:opacity-70"
        >
          {signingIn ? (
            <Loader2 className="h-5 w-5 animate-spin text-brand-1" />
          ) : (
            <FcGoogle className="h-5 w-5" />
          )}
          {signingIn ? "Signing you in…" : "Continue with Google"}
        </button>
        <Button
          variant="outline"
          onClick={signInWithGoogle}
          disabled={signingIn}
          className="h-12 w-full rounded-full text-base"
        >
          Log in
        </Button>
        <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          By continuing you agree to our Terms & Privacy Policy.
        </p>
      </div>
    </div>
  );
}

export default function AppWelcomePage() {
  const [onboarded, setOnboarded] = useState(hasSeenAppOnboarding);

  const finishOnboarding = () => {
    markAppOnboardingSeen();
    setOnboarded(true);
  };

  return (
    <>
      <Seo title="Welcome to StudyAssistant" noindex path="/" />
      {onboarded ? <Welcome /> : <Onboarding onDone={finishOnboarding} />}
    </>
  );
}
