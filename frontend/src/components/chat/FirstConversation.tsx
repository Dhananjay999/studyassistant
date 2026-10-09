// Aeva speaks first. Shown instead of the blank empty state right after
// onboarding resolves (and for an account that has never chatted): one
// greeting built from the learning profile, three concrete prompts for that
// class / exam / subject, and, when nobody does anything for a few seconds,
// the first prompt is sent as a live demo so the student sees an answer
// without having to know what to type.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Mic } from "lucide-react";
import { MemoryHint } from "@/components/chat/MemoryHint";
import { useAuth } from "@/contexts/AuthContext";
import { useLearningProfile } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { buildSuggestedPrompts } from "@/lib/suggestedPrompts";
import type { LearningProfile } from "@/types";

/** Idle time before the first prompt is auto-sent as a demo. */
export const DEMO_IDLE_MS = 6000;

export type FirstPromptKind = "first_conversation" | "first_conversation_demo";

/** One greeting line for the profile; null context → a generic opener. */
function greetingFor(
  name: string | null,
  profile: LearningProfile | null | undefined,
): { hello: string; lead: string } {
  const hello = `Hi${name ? ` ${name}` : ""}! I'm Aeva, your study buddy.`;
  const completed = profile?.personalization_status === "completed";
  const ctx = profile?.context;
  let situation: string | null = null;
  if (completed && ctx) {
    switch (ctx.type) {
      case "school":
        situation = `you're in ${ctx.class ?? "school"}${
          ctx.board && ctx.board !== "Not sure" ? ` (${ctx.board})` : ""
        }`;
        break;
      case "college":
        situation = `you're doing ${ctx.degree ?? "college"}${
          ctx.year ? `, ${ctx.year}` : ""
        }`;
        break;
      case "competitive_exam":
        situation = `you're preparing for ${ctx.exam ?? "a competitive exam"}`;
        break;
      case "skill_learning":
        situation = `you're learning ${ctx.skill ?? "something new"}`;
        break;
      case "working_professional":
        situation = "you're learning alongside work";
        break;
      default:
        situation = null;
    }
  }
  const subjects = (completed ? profile?.focus_areas ?? [] : []).slice(0, 2);
  const focus = subjects.length
    ? ` with ${subjects.join(" and ")} in focus`
    : "";
  const lead = situation
    ? `I see ${situation}${focus}. Here are three things we could start with — tap one, or type anything:`
    : "Ask me anything about what you're studying, or tap one of these to see what I can do:";
  return { hello, lead };
}

export function FirstConversation({
  onPick,
  autoDemo = false,
  onVoice,
}: {
  /** Send a prompt; `kind` says whether it was tapped or auto-demoed. */
  onPick: (text: string, kind: FirstPromptKind) => void;
  /** Auto-send the first prompt after `DEMO_IDLE_MS` of no interaction.
   *  Off by default; the chat turns it on right after onboarding. */
  autoDemo?: boolean;
  /** When provided (voice input available on this device), an "Ask by
   *  voice" chip starts dictation — the mic is otherwise easy to miss on a
   *  phone's first visit. */
  onVoice?: () => void;
}) {
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const { data: profile, isLoading } = useLearningProfile();
  const name = user?.full_name?.split(" ")[0] || null;

  // Built once the profile has resolved, then kept stable for this mount.
  const prompts = useMemo(
    () => (isLoading ? [] : buildSuggestedPrompts(profile, 3)),
    [profile, isLoading],
  );
  const { hello, lead } = useMemo(
    () => greetingFor(name, profile),
    [name, profile],
  );

  // armed → fired (demo sent) | cancelled (the student did something).
  const [demo, setDemo] = useState<"armed" | "fired" | "cancelled">(
    autoDemo ? "armed" : "cancelled",
  );

  useEffect(() => {
    if (demo !== "armed" || isLoading || prompts.length === 0) return;
    const cancel = () => setDemo("cancelled");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    // Any tap or key anywhere means the student is driving; stand down.
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") {
        cancel();
        return;
      }
      setDemo("fired");
      analytics.track(AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED, {
        kind: "first_conversation_demo",
      });
      onPick(prompts[0].text, "first_conversation_demo");
    }, DEMO_IDLE_MS);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, isLoading, prompts]);

  const enter = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end gap-4 px-4 py-6 sm:justify-center"
      data-analytics-private
      data-analytics-section="first_conversation"
    >
      {/* Aeva's opening bubble, styled like an answer in the thread. */}
      <motion.div {...enter(0)} className="flex gap-2 sm:gap-3">
        <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white sm:grid">
          <Bot className="h-4 w-4" />
        </span>
        <div className="glass min-w-0 max-w-full flex-1 rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed">
          <p className="font-semibold">{hello}</p>
          <p className="mt-1 text-foreground/90">{lead}</p>
        </div>
      </motion.div>

      <div className="flex flex-col gap-2 sm:pl-11">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="glass flex min-h-11 items-center gap-2 rounded-xl px-4"
              >
                <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted-foreground/25" />
                <span className="h-3 flex-1 animate-pulse rounded bg-muted-foreground/20" />
              </div>
            ))
          : prompts.map((p, i) => (
              <motion.button
                key={p.text}
                type="button"
                // Fixed name: the prompt text must not become the event name.
                data-analytics-name="Suggested prompt"
                {...enter(0.15 + i * 0.07)}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                onClick={() => {
                  setDemo("cancelled");
                  analytics.track(AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED, {
                    kind: "first_conversation",
                  });
                  onPick(p.text, "first_conversation");
                }}
                className="glass flex min-h-11 w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors hover:border-primary/30 hover:shadow-sm"
              >
                <p.icon className="h-4 w-4 shrink-0 text-brand-1" />
                <span className="min-w-0 flex-1">{p.text}</span>
              </motion.button>
            ))}

        <AnimatePresence initial={false}>
          {demo === "armed" && !isLoading && prompts.length > 0 && (
            <motion.p
              key="demo-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="px-1 text-xs text-muted-foreground"
            >
              Not sure where to start? I'll show you the first one in a few
              seconds.
            </motion.p>
          )}
        </AnimatePresence>

        {onVoice && (
          <motion.button
            type="button"
            {...enter(0.4)}
            onClick={() => {
              setDemo("cancelled");
              onVoice();
            }}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-brand-1/30 bg-brand-1/5 px-4 text-sm font-medium text-brand-1 transition-colors hover:bg-brand-1/10"
          >
            <Mic className="h-4 w-4" /> Ask by voice
          </motion.button>
        )}
      </div>

      <MemoryHint />
    </div>
  );
}
