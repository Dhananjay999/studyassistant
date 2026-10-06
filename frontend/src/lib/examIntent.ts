// Deterministic exam-preparation intent detection for the chat composer.
// Zero-cost (no LLM call): a message that clearly talks about preparing for
// an exam earns a contextual "Create Exam Plan" CTA above the composer.
// Deliberately conservative — a false positive shows a dismissible banner,
// nothing more.

const EXAM_INTENT = new RegExp(
  [
    "\\bexams?\\b",
    "\\bboard exams?\\b",
    "\\bboards\\b",
    "\\bentrance\\b",
    "\\bjee\\b",
    "\\bneet\\b",
    "\\bupsc\\b",
    "\\bgate\\b",
    "\\bcat\\b",
    "\\bssc\\b",
    "\\bcuet\\b",
    "\\bnda\\b",
    "\\bclat\\b",
    "\\bsyllabus\\b",
    "\\bstudy plan\\b",
    "\\brevision plan\\b",
    "\\btime ?table\\b",
    "\\bprepar(e|ing|ation) for\\b",
    "\\bmock tests?\\b",
    "\\bsemester exams?\\b",
    "\\bprevious year\\b",
    "\\bpyqs?\\b",
  ].join("|"),
  "i",
);

/** True when the student's message reads like exam preparation. */
export function detectExamIntent(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  return EXAM_INTENT.test(t);
}
