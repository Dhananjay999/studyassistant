// Shared bits for the `short_answer` quiz question type (a written answer,
// graded against a rubric when the attempt is submitted).

import type { QuizEvaluation, ShortAnswerGrading } from "@/types";

/** Hard cap on a written answer. Mirrors `MAX_ANSWER_CHARS` in
 * backend_v2/aeva/quiz/short_answer_grading.py, which cuts anything longer. */
export const SHORT_ANSWER_MAX_CHARS = 1000;

/** Analytics bucket for a 0–1 grading score (never the score text itself). */
export type ShortAnswerScoreBucket = "0-24" | "25-49" | "50-74" | "75-100";

export function shortAnswerScoreBucket(score: number): ShortAnswerScoreBucket {
  const pct = Math.round(Math.min(Math.max(score, 0), 1) * 100);
  if (pct >= 75) return "75-100";
  if (pct >= 50) return "50-74";
  if (pct >= 25) return "25-49";
  return "0-24";
}

/** The graded written answers of an attempt, in question order. */
export function shortAnswerGradings(ev: QuizEvaluation): ShortAnswerGrading[] {
  return (ev.per_question ?? []).flatMap((row) =>
    row.grading ? [row.grading] : [],
  );
}
