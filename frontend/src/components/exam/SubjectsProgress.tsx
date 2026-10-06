// Per-subject completion bars for the dashboard.

import { motion, useReducedMotion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { SectionHeading } from "@/components/exam/TodayPlanCard";
import { percentOf, subjectTone } from "@/components/exam/examFormat";
import { cn } from "@/lib/utils";
import type { ExamSubjectProgress } from "@/types";

export function SubjectsProgress({
  subjects,
}: {
  subjects: ExamSubjectProgress[];
}) {
  const reduce = useReducedMotion();
  if (subjects.length === 0) return null;

  return (
    <section>
      <SectionHeading icon={<BookOpen className="h-4 w-4 text-brand-1" />}>
        Subjects
      </SectionHeading>
      <GlassCard
        className="space-y-3.5 p-4"
        data-analytics-private
        data-analytics-section="exam_subjects"
      >
        {subjects.map((s, i) => {
          const pct = percentOf(s.completed, s.total);
          const tone = subjectTone(s.subject);
          return (
            <div key={s.subject}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.bar)} />
                  <span className="truncate font-medium">{s.subject}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.completed}/{s.total}
                  {s.in_progress > 0 && ` · ${s.in_progress} ongoing`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className={cn("h-full origin-left rounded-full", tone.bar)}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={{
                    duration: 0.35,
                    delay: Math.min(i * 0.05, 0.3),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          );
        })}
      </GlassCard>
    </section>
  );
}
