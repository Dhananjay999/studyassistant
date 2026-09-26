// Sign-in encouragement prompt for anonymous visitors on the public pages.
// Mounted ONCE in App.tsx; opened only through `requestAuthPrompt()` in
// lib/authPrompt.ts, which owns every "may it show?" rule. This component
// keeps that gate informed (auth state, route), runs the passive delayed
// trigger, renders the prompt, and reports what happened to analytics.
//
// Desktop: a compact centered card. Mobile: a bottom sheet with a drag
// handle (ResponsiveModal). Sign-in reuses the existing Google OAuth flow
// through GoogleButton / signInWithGoogle — nothing auth-related is new.
//
// Deliberately no history/back-button wiring: the Google CTA may fall back
// to a full-page redirect, and a queued `history.back()` from a closing
// overlay would cancel that navigation. Drag, overlay tap and "Not now"
// cover mobile dismissal.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { FileText, Layers, Sparkles } from "lucide-react";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { GoogleButton } from "@/components/landing/GoogleButton";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDelayedAuthPrompt } from "@/hooks/useDelayedAuthPrompt";
import {
  analytics,
  AnalyticsEvent,
  routeName,
  type AuthPromptCta,
  type AuthPromptTrigger,
} from "@/lib/analytics";
import {
  landingElapsedS,
  landingScrollPct,
  landingVisit,
  noteLandingAuthPrompt,
} from "@/lib/analytics/landing";
import {
  AUTH_PROMPT_ELIGIBLE_PATHS,
  closeAuthPrompt,
  dismissAuthPrompt,
  getAuthPromptState,
  getServerAuthPromptState,
  markAuthPromptConverted,
  setAuthPromptEnvironment,
  subscribeAuthPrompt,
  type AuthPromptDismissVia,
} from "@/lib/authPrompt";
import { cn } from "@/lib/utils";

/** Contextual copy: the reason the prompt opened shapes what it says. */
const COPY: Record<AuthPromptTrigger, { title: string; description: string }> =
  {
    demo_composer: {
      title: "Want to keep chatting with Aeva?",
      description:
        "Create a free account to ask your own questions, upload notes and PDFs, and turn any answer into quizzes and flashcards.",
    },
    demo_action: {
      title: "Unlock this with a free account",
      description:
        "Quizzes, flashcards, summaries and bookmarks all work on your own study material once you're signed in — it takes seconds with Google.",
    },
    delayed: {
      title: "Ready to study smarter?",
      description:
        "Chat with Aeva, upload your notes, and turn any answer into quizzes and flashcards. Free to start, and your progress is saved.",
    },
  };

const PERKS = [
  { icon: FileText, label: "Chat with your PDFs" },
  { icon: Sparkles, label: "AI quizzes" },
  { icon: Layers, label: "Flashcards" },
] as const;

// Subtle stagger: the card itself scales/fades in via ResponsiveModal; the
// content follows a beat later, top to bottom.
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
};
const pop: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 380, damping: 22 },
  },
};

export function AuthPrompt() {
  const { isAuthenticated, loading, signingIn, signInWithGoogle } = useAuth();
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();
  const { open, trigger } = useSyncExternalStore(
    subscribeAuthPrompt,
    getAuthPromptState,
    getServerAuthPromptState,
  );

  // Keep the copy of the trigger that opened us through the exit animation.
  const lastTriggerRef = useRef<AuthPromptTrigger>("delayed");
  if (trigger) lastTriggerRef.current = trigger;
  const copy = COPY[lastTriggerRef.current];

  // Latest route/layout for the impression event without re-running it.
  const envRef = useRef({ pathname, isMobile });
  envRef.current = { pathname, isMobile };

  useEffect(() => {
    setAuthPromptEnvironment({
      authenticated: isAuthenticated,
      authLoading: loading,
      signingIn,
      pathname,
    });
  }, [isAuthenticated, loading, signingIn, pathname]);

  // Logged in (from this prompt or anywhere else): close quietly and never
  // ask this device to "create an account" again.
  useEffect(() => {
    if (!isAuthenticated) return;
    markAuthPromptConverted();
    closeAuthPrompt();
  }, [isAuthenticated]);

  useDelayedAuthPrompt(
    !loading && !isAuthenticated && AUTH_PROMPT_ELIGIBLE_PATHS.has(pathname),
  );

  // Impression.
  useEffect(() => {
    if (!open || !trigger) return;
    const { pathname: path, isMobile: mobile } = envRef.current;
    noteLandingAuthPrompt("shown");
    analytics.track(AnalyticsEvent.AUTH_PROMPT_SHOWN, {
      trigger,
      page: landingVisit()?.page ?? routeName(path),
      layout: mobile ? "sheet" : "modal",
      time_since_entry_s: landingElapsedS(),
      scroll_pct: landingScrollPct(),
    });
  }, [open, trigger]);

  const dismiss = useCallback((via: AuthPromptDismissVia) => {
    const s = getAuthPromptState();
    if (!s.open || !s.trigger) return;
    const duration_ms = Math.round(performance.now() - s.openedAt);
    dismissAuthPrompt(via);
    noteLandingAuthPrompt("dismissed");
    analytics.track(AnalyticsEvent.AUTH_PROMPT_DISMISSED, {
      trigger: s.trigger,
      via,
      duration_ms,
    });
  }, []);

  // Escape / outside-tap handlers run before Radix reports the close, so we
  // know how it happened; anything else is the X (desktop) or a drag (mobile).
  const viaRef = useRef<AuthPromptDismissVia | null>(null);
  const onOpenChange = (next: boolean) => {
    if (next) return;
    const via = viaRef.current ?? (isMobile ? "drag" : "close");
    viaRef.current = null;
    dismiss(via);
  };

  const onCta = (cta: AuthPromptCta) => {
    const s = getAuthPromptState();
    if (s.trigger) {
      analytics.track(AnalyticsEvent.AUTH_PROMPT_CTA_CLICKED, {
        trigger: s.trigger,
        cta,
        duration_ms: Math.round(performance.now() - s.openedAt),
      });
    }
    noteLandingAuthPrompt("cta");
    // Close first so the "Signing you in…" modal doesn't stack on top. Not a
    // dismissal: an abandoned sign-in may be prompted again on a later visit.
    closeAuthPrompt();
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      analyticsName="Auth prompt"
    >
      <ResponsiveModalContent
        data-analytics-section="auth_prompt"
        onEscapeKeyDown={() => {
          viaRef.current = "escape";
        }}
        onPointerDownOutside={() => {
          viaRef.current = "outside";
        }}
        className={cn(
          "overflow-hidden",
          !isMobile &&
            "gap-0 rounded-3xl border-border/60 p-0 shadow-glow-lg sm:max-w-[400px] sm:rounded-3xl",
        )}
      >
        {/* Soft aurora glow behind the icon — the landing's visual signature. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl"
        />
        <ResponsiveModalBody
          className={cn(
            "relative",
            isMobile ? "px-2 pb-2 pt-3" : "px-7 pb-7 pt-9",
          )}
        >
          <motion.div
            variants={stagger}
            initial={reduce ? false : "hidden"}
            animate="show"
            className="flex flex-col items-center text-center"
          >
            <motion.span
              variants={pop}
              className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow"
            >
              <Sparkles className="h-7 w-7" aria-hidden="true" />
            </motion.span>

            <motion.div variants={rise} className="w-full">
              <ResponsiveModalHeader className="mt-4 items-center gap-2 text-center sm:text-center">
                <ResponsiveModalTitle className="font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">
                  {copy.title}
                </ResponsiveModalTitle>
                <ResponsiveModalDescription className="mx-auto max-w-[32ch] text-pretty leading-relaxed">
                  {copy.description}
                </ResponsiveModalDescription>
              </ResponsiveModalHeader>
            </motion.div>

            <motion.ul
              variants={rise}
              aria-label="What you get"
              className="mt-4 flex flex-wrap justify-center gap-1.5"
            >
              {PERKS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                >
                  <Icon className="h-3 w-3 text-brand-1" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </motion.ul>

            <motion.div variants={rise} className="mt-6 w-full">
              <GoogleButton
                fullWidth
                location="auth_prompt"
                onClick={() => onCta("google")}
              />
            </motion.div>

            <motion.p
              variants={rise}
              className="mt-3 text-xs text-muted-foreground"
            >
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  onCta("login");
                  signInWithGoogle();
                }}
                disabled={signingIn}
                className="font-semibold text-brand-1 underline-offset-2 hover:underline disabled:opacity-60"
              >
                Log in
              </button>
            </motion.p>

            <motion.button
              variants={rise}
              type="button"
              onClick={() => dismiss("not_now")}
              className="touch-target mt-1 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Not now
            </motion.button>
          </motion.div>
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
