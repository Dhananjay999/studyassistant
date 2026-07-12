// Print an attempt report: builds a small, self-contained printable page in a
// hidden iframe and opens the browser's print dialog. No print CSS leaks into
// (or depends on) the app — the report inside a drawer prints cleanly.

import { formatDuration, formatMarks } from "@/lib/quizFormat";
import type { QuizContent, QuizEvaluation } from "@/types";

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function statRow(label: string, value: string): string {
  return `<tr><td>${esc(label)}</td><td class="v">${esc(value)}</td></tr>`;
}

function reviewItem(
  index: number,
  prompt: string,
  row: QuizEvaluation["per_question"][number],
): string {
  const status = row.is_correct ? "correct" : row.partial ? "partial" : "wrong";
  const label = row.is_correct ? "Correct" : row.partial ? "Partial" : "Incorrect";
  return `<li class="q ${status}">
    <p class="p">${index + 1}. ${esc(prompt)} <span class="tag">${label}</span></p>
    <p class="a">Your answer: ${esc(row.user_answer.join(", ") || "—")}</p>
    ${
      row.is_correct
        ? ""
        : `<p class="a ok">Correct: ${esc(row.correct_answer.join(", "))}</p>`
    }
  </li>`;
}

/** Compose the printable HTML and print it via a temporary hidden iframe. */
export function printAttemptReport(
  quiz: QuizContent,
  ev: QuizEvaluation,
): void {
  const isExam = ev.final_score !== undefined && ev.final_score !== null;
  const questions = quiz.questions ?? [];
  const prompts = new Map(questions.map((q) => [q.id, q.prompt]));

  const stats = [
    statRow("Score", `${Math.round(ev.score)}%`),
    isExam
      ? statRow("Final marks", formatMarks(ev.final_score ?? 0, ev.max_marks))
      : "",
    statRow("Correct", `${ev.correct_count} / ${ev.total}`),
    statRow("Incorrect", String(ev.incorrect_count)),
    statRow("Unanswered", String(ev.unanswered_count)),
    ev.time_taken_seconds
      ? statRow("Time taken", formatDuration(ev.time_taken_seconds))
      : "",
    statRow("Date", new Date().toLocaleDateString()),
  ].join("");

  const review = ev.per_question
    .map((row, i) =>
      reviewItem(i, prompts.get(row.question_id) ?? row.question_id, row),
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(quiz.title)} — Result</title>
<style>
  body { font-family: system-ui, sans-serif; color: #111; margin: 2rem; }
  h1 { font-size: 1.35rem; margin: 0 0 0.2rem; }
  .sub { color: #666; font-size: 0.85rem; margin: 0 0 1.2rem; }
  table { border-collapse: collapse; margin-bottom: 1.4rem; }
  td { padding: 0.25rem 1.5rem 0.25rem 0; font-size: 0.9rem; color: #444; }
  td.v { font-weight: 700; color: #111; }
  h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  .q { border: 1px solid #ddd; border-radius: 8px; padding: 0.6rem 0.8rem;
       margin-bottom: 0.5rem; page-break-inside: avoid; }
  .p { font-weight: 600; font-size: 0.9rem; margin: 0; }
  .a { font-size: 0.8rem; color: #555; margin: 0.25rem 0 0; }
  .a.ok { color: #067647; }
  .tag { font-size: 0.7rem; font-weight: 700; margin-left: 0.4rem; }
  .correct .tag { color: #067647; }
  .partial .tag { color: #b54708; }
  .wrong .tag { color: #b42318; }
  footer { margin-top: 1.5rem; color: #999; font-size: 0.75rem; }
</style></head><body>
<h1>${esc(quiz.title)}</h1>
<p class="sub">${esc(quiz.topic || "Quiz result")} · StudyAssistant</p>
<table>${stats}</table>
<h2>Answer review</h2>
<ul>${review}</ul>
<footer>Generated with StudyAssistant</footer>
</body></html>`;

  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  // Give the iframe a beat to lay out, then print and clean up. The removal
  // is delayed so the print dialog keeps a live document to read from.
  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  }, 150);
}
