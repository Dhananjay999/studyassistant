// Compact "Exam Prep" showcase: a three-step Plan → Learn → Practice strip
// where each step pairs a sentence of copy with a small hand-built replica of
// the in-app screen (marketing never uses screenshots — same as HeroDemo and
// RevisionShowcase). The replicas are decorative (aria-hidden); every claim is
// in the visible copy.

import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  CalendarCheck,
  Check,
  Layers,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Reveal } from "@/components/common/Reveal";
import { cn } from "@/lib/utils";

// Build-time prerender: render the finished state with no entrance
// animations (matches Hero.tsx / RevisionShowcase.tsx / Reveal.tsx).
const IS_SERVER = typeof window === "undefined";

const STEPS = [
  {
    icon: CalendarCheck,
    title: "Plan",
    body: "Name your exam, its date, your class or stream, subjects, and daily study time. Aeva researches the official syllabus and spreads every topic across the days you have.",
  },
  {
    icon: BookOpen,
    title: "Learn",
    body: "Open a topic and Aeva writes the lesson: why it matters, the core ideas, worked examples, things to remember, common mistakes, and a self-check.",
  },
  {
    icon: ListChecks,
    title: "Practice",
    body: "Quiz yourself and flip flashcards on the same topic, ask doubts in a box scoped to it, run the study timer, then mark it done and move on.",
  },
];

const PLAN_DAY = [
  { subject: "Physics", topics: ["Motion", "Force & laws"] },
  { subject: "Maths", topics: ["Quadratic equations"] },
];

const LESSON_OUTLINE = [
  "Why it matters",
  "Core ideas",
  "Worked examples",
  "Things to remember",
  "Common mistakes",
  "Self-check",
];

const PRACTICE_ACTIONS = [
  { label: "Quiz", icon: ListChecks, primary: true },
  { label: "Flashcards", icon: Layers, primary: false },
  { label: "Ask a doubt", icon: MessageCircleQuestion, primary: false },
];

const DONE = 7;
const TOTAL = 24;

function PlanReplica() {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-xs font-bold">Day 3 · Thursday</p>
        <span className="rounded-full bg-brand-1/15 px-2 py-0.5 text-[11px] font-semibold text-brand-1">
          2 hrs
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {PLAN_DAY.map((d) => (
          <li key={d.subject} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold">{d.subject}</span>
            {d.topics.map((t) => (
              <span
                key={t}
                className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LessonReplica({ still }: { still: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <p className="truncate font-display text-xs font-bold">
        Lesson · Force &amp; laws of motion
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {LESSON_OUTLINE.map((item, i) => (
          <motion.li
            key={item}
            initial={still ? false : { opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.3, delay: 0.2 + i * 0.06 }}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="truncate">{item}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function PracticeReplica({ still }: { still: boolean }) {
  const pct = Math.round((DONE / TOTAL) * 100);
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap gap-1.5">
        {PRACTICE_ACTIONS.map((a) => (
          <span
            key={a.label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              a.primary
                ? "bg-brand-gradient text-white shadow-glow"
                : "border border-border/60 bg-background/60 text-muted-foreground",
            )}
          >
            <a.icon className="h-3 w-3" /> {a.label}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {DONE} of {TOTAL} topics done
        </span>
        <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      {/* Width is always set; only the transform animates, so prerendered
         and reduced-motion output shows the finished bar. */}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full origin-left rounded-full bg-brand-gradient"
          style={{ width: `${pct}%` }}
          initial={still ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

export function ExamPrepShowcase() {
  const reduce = useReducedMotion();
  const still = IS_SERVER || Boolean(reduce);
  const replicas = [
    <PlanReplica key="plan" />,
    <LessonReplica key="learn" still={still} />,
    <PracticeReplica key="practice" still={still} />,
  ];

  return (
    <section
      id="exam-prep"
      data-landing-section="exam_prep"
      aria-labelledby="exam-prep-heading"
      className="relative overflow-hidden py-24"
    >
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-1/30 bg-brand-1/10 px-3 py-1 text-xs font-semibold text-brand-1">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            NEW · Exam Prep
          </span>
          <h2
            id="exam-prep-heading"
            className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Aeva plans your exam —{" "}
            <span className="text-gradient">and teaches every topic</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            A day-by-day plan built from the official syllabus, a lesson for
            every topic, and practice until it sticks. For school exams, board
            exams, college and university exams, or a single subject or unit
            test.
          </p>
        </Reveal>

        <ol className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="h-full list-none">
              <Reveal delay={i * 0.1} className="h-full">
                <GlassCard className="flex h-full flex-col p-6 transition-transform duration-300 hover:-translate-y-1">
                  <div className="flex items-center gap-3">
                    <span className="relative inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white">
                      <s.icon className="h-6 w-6" aria-hidden="true" />
                      <span
                        aria-hidden="true"
                        className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-background text-[11px] font-bold text-foreground ring-1 ring-border"
                      >
                        {i + 1}
                      </span>
                    </span>
                    <h3 className="font-display text-lg font-bold">{s.title}</h3>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{s.body}</p>
                  <div aria-hidden="true" className="mt-4 select-none">
                    {replicas[i]}
                  </div>
                </GlassCard>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delay={0.3} className="mx-auto mt-8 max-w-2xl text-center">
          <p className="text-xs text-muted-foreground">
            Full preparation for entrance exams such as JEE, NEET, or UPSC
            isn't available yet.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
