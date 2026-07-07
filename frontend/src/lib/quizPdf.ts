// Builds a professional, exam-paper-style PDF for a quiz using jsPDF. jsPDF
// draws vector text/shapes, so the output is byte-identical across every
// browser and OS (Chrome/Safari/Firefox, desktop & mobile) and downloads
// directly — no browser print dialog. jspdf is imported dynamically by the
// caller so it never lands in the initial bundle.
//
// Layout: a branded header (StudyAssistant mark + quiz meta), a numbered
// question body with lettered options, automatic page breaks that reserve a
// footer band, per-page footers with page numbers and branding, and an
// optional answer-key section derived from each question's correct_answers.

import type { jsPDF } from "jspdf";
import { SITE_URL } from "@/lib/seo";
import { difficultyMeta } from "@/lib/quizFormat";
import { latexToText } from "@/lib/latexToText";
import type { QuizExportContent, QuizExportQuestion } from "@/types";

export type PaperSize = "a4" | "letter";

export interface QuizPdfOptions {
  includeAnswerKey: boolean;
  paper?: PaperSize;
}

// Brand palette (matches favicon.svg / --brand-1). RGB tuples for jsPDF.
const VIOLET: [number, number, number] = [124, 58, 237];
const TEAL: [number, number, number] = [20, 184, 166];
const INK: [number, number, number] = [23, 23, 27];
const MUTED: [number, number, number] = [107, 114, 128];
const HAIRLINE: [number, number, number] = [214, 216, 222];

const MARGIN = { top: 52, bottom: 58, left: 54, right: 54 };
const FOOTER_RESERVE = 42; // space kept clear at the bottom for the footer band

const optionLetter = (i: number) => String.fromCharCode(97 + i); // a, b, c…

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Draw the small StudyAssistant brand mark: a violet rounded square with a
 * white 4-point sparkle, echoing favicon.svg. Purely vector, no image asset. */
function drawLogoMark(doc: jsPDF, x: number, y: number, size: number) {
  doc.setFillColor(...VIOLET);
  doc.roundedRect(x, y, size, size, size * 0.26, size * 0.26, "F");

  // A 4-point sparkle as two crossed diamonds (a big one + a small accent),
  // built from triangles so it needs no path/gradient support.
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.3;
  doc.setFillColor(255, 255, 255);
  // main diamond
  doc.triangle(cx, cy - r, cx + r, cy, cx, cy + r, "F");
  doc.triangle(cx, cy - r, cx - r, cy, cx, cy + r, "F");
  // small accent diamond top-right
  const ax = x + size * 0.76;
  const ay = y + size * 0.26;
  const ar = size * 0.11;
  doc.triangle(ax, ay - ar, ax + ar, ay, ax, ay + ar, "F");
  doc.triangle(ax, ay - ar, ax - ar, ay, ax, ay + ar, "F");
}

interface Layout {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  contentW: number;
  y: number;
}

/** Ensure `needed` pt of vertical space remain before the footer band;
 * otherwise start a new page. Returns the (possibly reset) cursor. */
function ensureSpace(l: Layout, needed: number) {
  if (l.y + needed > l.pageH - MARGIN.bottom - FOOTER_RESERVE) {
    l.doc.addPage();
    l.y = MARGIN.top;
  }
}

function drawHeader(l: Layout, quiz: QuizExportContent, subtitle: string) {
  const { doc } = l;
  const x = MARGIN.left;

  drawLogoMark(doc, x, l.y, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text("StudyAssistant", x + 40, l.y + 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, x + 40, l.y + 24);
  l.y += 46;

  // Quiz title.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(quiz.title, l.contentW);
  doc.text(titleLines, x, l.y);
  l.y += titleLines.length * 22 + 4;

  // Meta line: Subject · Difficulty · Questions · Date.
  const diff = difficultyMeta(quiz.difficulty ?? null).label;
  const meta = [
    quiz.topic ? `Subject: ${quiz.topic}` : null,
    `Difficulty: ${diff}`,
    `Questions: ${quiz.questions.length}`,
    `Generated: ${formatToday()}`,
  ]
    .filter(Boolean)
    .join("    •    ");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const metaLines = doc.splitTextToSize(meta, l.contentW);
  doc.text(metaLines, x, l.y);
  l.y += metaLines.length * 13 + 8;

  // Exam-paper info row (fillable when printed).
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.6);
  doc.line(x, l.y, x + l.contentW, l.y);
  l.y += 16;
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text("Name: ______________________", x, l.y);
  doc.text("Date: __________", x + l.contentW - 110, l.y);
  l.y += 16;
  doc.setDrawColor(...HAIRLINE);
  doc.line(x, l.y, x + l.contentW, l.y);
  l.y += 18;

  // Instructions.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    "Answer all questions. For multiple-select questions, choose every correct option.",
    x,
    l.y,
  );
  doc.setFont("helvetica", "normal");
  l.y += 18;
}

function drawQuestion(
  l: Layout,
  q: QuizExportQuestion,
  number: number,
) {
  const { doc } = l;
  const x = MARGIN.left;
  const promptIndent = 22;

  // Measure the prompt first so we can keep it with at least its first option.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const promptLines = doc.splitTextToSize(
    latexToText(q.prompt),
    l.contentW - promptIndent,
  );
  ensureSpace(l, promptLines.length * 15 + 40);

  // Number badge + prompt.
  doc.setTextColor(...INK);
  doc.text(`${number}.`, x, l.y);
  doc.text(promptLines, x + promptIndent, l.y);
  l.y += promptLines.length * 15 + 6;

  // Options.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const optIndent = promptIndent + 6;
  q.options.forEach((opt, i) => {
    const label = `${optionLetter(i)})  ${latexToText(opt)}`;
    const lines = doc.splitTextToSize(label, l.contentW - optIndent - 6);
    ensureSpace(l, lines.length * 14 + 4);
    doc.setTextColor(...INK);
    doc.text(lines, x + optIndent, l.y);
    l.y += lines.length * 14 + 2;
  });

  l.y += 12; // gap between questions
}

/** Map a question's correct option text(s) to a compact answer-key string:
 * lettered options → "B" / "A & D"; true_false → the option text verbatim. */
function answerKeyText(q: QuizExportQuestion): string {
  const correct = q.correct_answers ?? [];
  if (q.type === "true_false") {
    return correct.join(" / ") || "—";
  }
  const letters = correct
    .map((ans) => q.options.indexOf(ans))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)
    .map((idx) => optionLetter(idx).toUpperCase());
  if (letters.length === 0) return latexToText(correct.join(", ")) || "—";
  return letters.join(" & ");
}

function drawAnswerKey(l: Layout, quiz: QuizExportContent) {
  const { doc } = l;
  const x = MARGIN.left;

  doc.addPage();
  l.y = MARGIN.top;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...VIOLET);
  doc.text("Answer Key", x, l.y);
  l.y += 10;
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.6);
  doc.line(x, l.y, x + l.contentW, l.y);
  l.y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  quiz.questions.forEach((q, i) => {
    ensureSpace(l, 18);
    doc.setTextColor(...INK);
    doc.setFont("helvetica", "bold");
    doc.text(`Question ${i + 1}`, x, l.y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEAL);
    doc.text(`→  ${answerKeyText(q)}`, x + 90, l.y);
    l.y += 18;
  });
}

/** Draw the footer band (branding + page numbers) on every page. Called last so
 * the total page count is known. */
function drawFooters(doc: jsPDF, pageW: number, pageH: number) {
  const total = doc.getNumberOfPages();
  const site = SITE_URL.replace(/^https?:\/\//, "");
  const year = new Date().getFullYear();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const fy = pageH - MARGIN.bottom + 8;
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.5);
    doc.line(MARGIN.left, fy - 12, pageW - MARGIN.right, fy - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated with StudyAssistant · ${site}`, MARGIN.left, fy);
    doc.text(`© ${year} StudyAssistant`, MARGIN.left, fy + 10);
    doc.text(`Page ${p} of ${total}`, pageW - MARGIN.right, fy, {
      align: "right",
    });
  }
}

/** Build the quiz PDF and return the jsPDF doc (caller decides save/share). */
export async function generateQuizPdf(
  quiz: QuizExportContent,
  options: QuizPdfOptions,
): Promise<jsPDF> {
  const { jsPDF: JsPDF } = await import("jspdf");
  const doc = new JsPDF({
    unit: "pt",
    format: options.paper ?? "a4",
    orientation: "portrait",
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const l: Layout = {
    doc,
    pageW,
    pageH,
    contentW: pageW - MARGIN.left - MARGIN.right,
    y: MARGIN.top,
  };

  drawHeader(l, quiz, "Question Paper");
  quiz.questions.forEach((q, i) => drawQuestion(l, q, i + 1));

  if (options.includeAnswerKey) {
    drawAnswerKey(l, quiz);
  }

  drawFooters(doc, pageW, pageH);
  return doc;
}

/** Convenience: build + download the quiz PDF with a sensible filename. */
export async function downloadQuizPdf(
  quiz: QuizExportContent,
  options: QuizPdfOptions,
): Promise<void> {
  const doc = await generateQuizPdf(quiz, options);
  const slug =
    quiz.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "quiz";
  doc.save(`${slug}.pdf`);
}
