// The limits and defaults a new exam plan must respect, in one place. Both
// ways of creating a plan use them: the three-step setup form and the
// one-screen cram card offered in chat. They mirror the backend's
// CreateExamPlanSchema (aeva/exam_prep/schema/exam_prep_schema.py).

export const SUBJECT_MAX = 12;
export const SUBJECT_LEN = 40;
export const EXAM_NAME_LEN = 80;
export const MIN_MINUTES = 15;
export const MAX_MINUTES = 720;

/** Starting subjects guessed from a free-text exam name. */
export function defaultSubjectsFor(examName: string): string[] {
  const n = examName.toLowerCase();
  if (/\bjee\b|iit/.test(n)) return ["Physics", "Chemistry", "Mathematics"];
  if (/\bneet\b|aiims/.test(n)) return ["Physics", "Chemistry", "Biology"];
  if (/upsc|\bias\b|civil/.test(n))
    return [
      "Polity",
      "History",
      "Geography",
      "Economy",
      "Environment",
      "Current Affairs",
    ];
  if (/\bssc\b|bank|ibps|\bsbi\b|\brrb\b/.test(n))
    return [
      "Quantitative Aptitude",
      "Reasoning",
      "English",
      "General Awareness",
    ];
  if (/\bgate\b/.test(n))
    return ["Engineering Mathematics", "General Aptitude", "Core subjects"];
  if (/\bcat\b|\bxat\b|\bmba\b/.test(n))
    return ["Quantitative Aptitude", "Verbal Ability", "DILR"];
  if (/cbse|icse|board|class|school|\bsslc\b|\bhsc\b/.test(n))
    return ["Mathematics", "Science", "English", "Social Science"];
  return [];
}

/** Add `subject` to `subjects` under the form's rules (trim, length cap,
 * case-insensitive de-duplication, at most SUBJECT_MAX). Returns the same
 * array when nothing changes. */
export function withSubject(subjects: string[], subject: string): string[] {
  const s = subject.trim().slice(0, SUBJECT_LEN);
  if (!s) return subjects;
  if (subjects.some((x) => x.toLowerCase() === s.toLowerCase())) return subjects;
  if (subjects.length >= SUBJECT_MAX) return subjects;
  return [...subjects, s];
}
