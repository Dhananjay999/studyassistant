// Shown at /exam when the student has no active plan: what Exam Prep does and
// one primary action to set it up.

import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarCheck,
  ListChecks,
  MessageSquare,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { analyticsAttrs } from "@/lib/analytics";

const POINTS = [
  {
    icon: CalendarCheck,
    title: "A day-by-day plan",
    body: "Every subject spread across the days you have left.",
  },
  {
    icon: ListChecks,
    title: "Quizzes and flashcards per topic",
    body: "Made on demand for exactly what you study that day.",
  },
  {
    icon: MessageSquare,
    title: "An exam coach that knows your plan",
    body: "Ask Aeva anything; it answers with your plan in mind.",
  },
];

export function ExamEmptyState() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  return (
    <div className="space-y-4">
      <GlassCard strong className="relative overflow-hidden p-6 text-center sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full bg-brand-1/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 -right-10 h-48 w-48 rounded-full bg-brand-3/15 blur-3xl"
        />
        <motion.span
          initial={reduce ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-1 to-brand-2 text-white shadow-glow"
        >
          <Target className="h-8 w-8" />
        </motion.span>
        <h2 className="mt-5 font-display text-2xl font-extrabold leading-tight">
          Plan your exam, one day at a time
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Tell Aeva which exam you're preparing for and how much time you have.
          You'll get a realistic study plan, and everything you need to work
          through it.
        </p>
        <Button
          variant="brand"
          size="lg"
          {...analyticsAttrs("exam.empty.setup", "Set up exam plan", "exam")}
          onClick={() => navigate("/exam/setup")}
          className="mt-6 h-12 w-full gap-2 sm:w-auto sm:px-8"
        >
          <Sparkles className="h-4 w-4" /> Set up my exam plan
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          Takes about a minute.
        </p>
      </GlassCard>

      <div className="grid gap-3 sm:grid-cols-3">
        {POINTS.map((p, i) => (
          <motion.div
            key={p.title}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.06, 0.3) }}
          >
            <GlassCard className="flex h-full gap-3 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
                <p.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-bold leading-tight">
                  {p.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{p.body}</p>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
