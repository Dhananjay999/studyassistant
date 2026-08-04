// Flagship "AI Revision Mode" section: copy on the left, a static-but-
// animated replica of the in-app revision dashboard on the right (marketing
// never uses screenshots — the product is always shown as a hand-built
// replica, same as HeroDemo). The replica is decorative (aria-hidden); all
// meaning lives in the copy column.

import { motion, useReducedMotion } from "framer-motion";
import {
  Brain,
  CalendarClock,
  Flame,
  Layers,
  ListChecks,
  SmilePlus,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Reveal } from "@/components/common/Reveal";
import { cn } from "@/lib/utils";

// Build-time prerender: render the finished state with no entrance
// animations (matches Hero.tsx / HeroDemo.tsx / Reveal.tsx).
const IS_SERVER = typeof window === "undefined";

const BENEFITS = [
  {
    icon: CalendarClock,
    title: "Spaced-repetition schedule",
    body: "Every topic you study gets a review date timed to just before you'd forget it — no planning required.",
  },
  {
    icon: Target,
    title: "Weak topics, with reasons",
    body: "Aeva watches your quiz scores and flashcard ratings and tells you why a topic is due — like “You scored 58% on this 3 days ago.”",
  },
  {
    icon: SmilePlus,
    title: "Confidence check-ins",
    body: "After each session, tell Aeva how it went — \u{1F615}, \u{1F642}, or \u{1F60E} — and your revision schedule adjusts instantly.",
  },
  {
    icon: Flame,
    title: "Streaks that keep you going",
    body: "Start each day with a recap of what you studied yesterday, what's due today, and the streak you don't want to break.",
  },
];

const TONE = {
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
} as const;

const DUE_TOPICS = [
  {
    topic: "Photosynthesis — light reactions",
    pct: 58,
    tone: "amber" as const,
    meta: "Studied 3 days ago · Due today",
    reason: "You scored 58% on the last quiz — a quick review locks it in.",
    primary: "Quiz",
  },
  {
    topic: "Chemical bonding",
    pct: 34,
    tone: "red" as const,
    meta: "Studied 6 days ago · Overdue by 2 days",
    reason: "You rated these flashcards “Hard” twice in a row.",
    primary: "Flashcards",
  },
];

const ACTIONS = [
  { label: "Revise", icon: Sparkles },
  { label: "Quiz", icon: ListChecks },
  { label: "Flashcards", icon: Layers },
];

const CONFIDENCE = [
  {
    emoji: "\u{1F615}",
    label: "Still confused",
    cls: "border-red-500/40 text-red-600 dark:text-red-400",
  },
  {
    emoji: "\u{1F642}",
    label: "Better",
    cls: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  {
    emoji: "\u{1F60E}",
    label: "Mastered",
    cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  },
];

function TopicRow({
  topic,
  pct,
  tone,
  meta,
  reason,
  primary,
  still,
  delay,
}: {
  topic: string;
  pct: number;
  tone: keyof typeof TONE;
  meta: string;
  reason?: string;
  primary?: string;
  still: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay }}
      className="mt-2 rounded-xl border border-border/60 bg-card/40 p-3.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate font-display text-sm font-bold">{topic}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
            TONE[tone],
          )}
        >
          {pct}%
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
      {/* Strength bar: width is always set; only the transform animates, so
         prerendered/reduced-motion output shows the finished bar. */}
      <div className="mt-2 h-1.5 max-w-56 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full origin-left rounded-full bg-brand-gradient"
          style={{ width: `${pct}%` }}
          initial={still ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{
            duration: 0.9,
            delay: delay + 0.15,
            ease: [0.22, 1, 0.36, 1],
          }}
        />
      </div>
      {reason && (
        <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
      )}
      {primary && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <span
              key={a.label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                a.label === primary
                  ? "bg-brand-gradient text-white shadow-glow"
                  : "border border-border/60 bg-card/50 text-muted-foreground",
              )}
            >
              <a.icon className="h-3.5 w-3.5" /> {a.label}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function RevisionShowcase() {
  const reduce = useReducedMotion();
  const still = IS_SERVER || Boolean(reduce);

  return (
    <section
      id="revision"
      aria-labelledby="revision-heading"
      className="relative overflow-hidden py-24"
    >
      <div className="container">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          {/* Copy column */}
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-1/30 bg-brand-1/10 px-3 py-1 text-xs font-semibold text-brand-1">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              NEW · AI Revision Mode
            </span>
            <h2
              id="revision-heading"
              className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Aeva remembers what you learn —{" "}
              <span className="text-gradient">so you don't forget it</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              Most study apps stop at the answer. StudyAssistant tracks a
              memory strength for every topic and builds a daily revision
              plan around it — what needs revision now, what's due today,
              and what you've recently mastered.
            </p>
            <ul className="mt-8 space-y-5">
              {BENEFITS.map((b) => (
                <li key={b.title} className="flex items-start gap-3.5">
                  <span className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white">
                    <b.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold">
                      {b.title}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {b.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Dashboard replica — decorative; real content is on the left */}
          <Reveal delay={0.1}>
            <div aria-hidden="true" className="relative select-none">
              <div className="motion-loop absolute -right-3 -top-5 z-10 hidden animate-float sm:block">
                <GlassCard className="flex items-center gap-2 px-3 py-2 text-xs font-medium shadow-glow">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  Memory strength +18% this week
                </GlassCard>
              </div>

              <GlassCard strong className="p-5 shadow-glow-lg sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient text-white">
                      <Brain className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-display text-sm font-bold">
                        Your revision plan
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Welcome back — yesterday you studied Biology
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
                    <Flame className="h-3.5 w-3.5" /> 12-day streak
                  </span>
                </div>

                <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {"\u{1F525}"} Needs revision
                </p>
                {DUE_TOPICS.map((t, i) => (
                  <TopicRow
                    key={t.topic}
                    {...t}
                    still={still}
                    delay={0.15 + i * 0.12}
                  />
                ))}

                <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {"\u{1F7E2}"} Recently mastered
                </p>
                <TopicRow
                  topic="Newton's laws of motion"
                  pct={92}
                  tone="emerald"
                  meta="Mastered · Next review in 12 days"
                  still={still}
                  delay={0.4}
                />

                <div className="mt-5 rounded-xl border border-brand-1/20 bg-card/40 p-3.5">
                  <p className="text-center text-xs font-medium">
                    How confident do you feel about{" "}
                    <span className="text-brand-1">Photosynthesis</span>?
                  </p>
                  <div className="mt-2.5 flex flex-wrap justify-center gap-2">
                    {CONFIDENCE.map((l) => (
                      <span
                        key={l.label}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                          l.cls,
                        )}
                      >
                        <span>{l.emoji}</span> {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              </GlassCard>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
