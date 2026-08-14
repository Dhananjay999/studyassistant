import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  FileText,
  Globe,
  Layers,
  ListChecks,
  Palette,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  THINKING_PROGRESSIONS,
  type ThinkingHint,
} from "@/lib/loadingMessages";

// Context-specific badge icon per loader; the animation stays subtle (pulse,
// or the app's gentle float for image generation) so it cues the task without
// demanding attention.
const HINT_ICON: Record<ThinkingHint, { icon: LucideIcon; anim: string }> = {
  thinking: { icon: Sparkles, anim: "animate-pulse" },
  web: { icon: Globe, anim: "animate-pulse" },
  media: { icon: FileText, anim: "animate-pulse" },
  quiz: { icon: ListChecks, anim: "animate-pulse" },
  flashcard: { icon: Layers, anim: "animate-pulse" },
  image: { icon: Palette, anim: "animate-float" },
};

const shimmerBar =
  "motion-loop animate-shimmer rounded-full bg-gradient-to-r " +
  "from-muted via-muted/30 to-muted bg-[length:200%_100%]";

/** Standard chat answer skeleton: a few shimmering text lines. */
function TextSkeleton() {
  return (
    <div className="space-y-2">
      {[92, 78, 64].map((w) => (
        <div
          key={w}
          style={{ width: `${w}%` }}
          className={`h-3 ${shimmerBar}`}
        />
      ))}
    </div>
  );
}

/** Quiz skeleton: a question line plus a stack of option rows. */
function QuizSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
      <div className={`mb-3 h-3.5 w-3/4 ${shimmerBar}`} />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border border-border/40 px-2.5 py-2"
          >
            <div className={`h-3.5 w-3.5 rounded-full ${shimmerBar}`} />
            <div
              style={{ width: `${70 - i * 8}%` }}
              className={`h-3 ${shimmerBar}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Flashcard skeleton: a small deck of card previews. */
function FlashcardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex h-20 flex-col justify-between rounded-xl border border-border/50 bg-muted/20 p-2.5"
        >
          <div className={`h-3 w-2/3 ${shimmerBar}`} />
          <div className={`h-2.5 w-1/2 ${shimmerBar}`} />
        </div>
      ))}
    </div>
  );
}

/** Image skeleton: a single shimmering canvas placeholder. */
function ImageSkeleton() {
  return (
    <div
      className={`grid h-40 w-full max-w-sm place-items-center rounded-xl border border-border/50 ${shimmerBar}`}
    >
      <Palette className="h-6 w-6 text-muted-foreground/50" />
    </div>
  );
}

function LoadingSkeleton({ hint }: { hint?: ThinkingHint }) {
  if (hint === "quiz") return <QuizSkeleton />;
  if (hint === "flashcard") return <FlashcardSkeleton />;
  if (hint === "image") return <ImageSkeleton />;
  return <TextSkeleton />;
}

/**
 * Gemini-style "thinking" state. Messages advance on a *progressive* cadence
 * rather than rapid switching, so longer waits feel intentional. The skeleton
 * shape below the status line matches the task being generated (chat, quiz, or
 * flashcards).
 */
export function ThinkingIndicator({ hint }: { hint?: ThinkingHint }) {
  const steps = THINKING_PROGRESSIONS[hint ?? "thinking"];
  const { icon: Icon, anim } = HINT_ICON[hint ?? "thinking"];
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
    if (reduce) return undefined;
    const timers = steps
      .slice(1)
      .map((s, i) =>
        window.setTimeout(() => setStep(i + 1), s.at),
      );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [steps, reduce]);

  return (
    <div className="space-y-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-1/10 px-2.5 py-1 text-xs font-medium text-brand-1">
        <Icon className={`h-3 w-3 ${reduce ? "" : anim}`} />
        <span className="relative inline-block">
          <AnimatePresence mode="wait">
            <motion.span
              key={step}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -6, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block"
            >
              {steps[step].text}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
      <LoadingSkeleton hint={hint} />
    </div>
  );
}
