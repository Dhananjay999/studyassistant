import { Reveal } from "@/components/common/Reveal";

/**
 * Definitional prose section. Answer-engine crawlers (and Google's AI
 * overviews) lift direct, self-contained definitions — this section exists so
 * "what is an AI study assistant" has a quotable answer that names the
 * product. Keep the copy factual and liftable: short paragraphs, a concrete
 * capability list, no marketing fluff.
 */
const CAPABILITIES = [
  {
    term: "Homework help",
    detail:
      "ask any question and get a clear, step-by-step explanation with cited sources.",
  },
  {
    term: "Chat with your PDFs",
    detail:
      "upload notes, textbooks, and slides, then ask questions — answers cite the exact page.",
  },
  {
    term: "AI quiz generator",
    detail:
      "turn any topic or document into a practice quiz with instant grading and feedback.",
  },
  {
    term: "AI flashcards",
    detail:
      "auto-generate decks from your material and track your mastery over time.",
  },
  {
    term: "Exam preparation",
    detail:
      "build study plans, test yourself, and see exactly what to revise before the exam.",
  },
  {
    term: "Notes and summaries",
    detail:
      "summarize chapters, lectures, and documents into revision-ready notes.",
  },
];

export function WhatIs() {
  return (
    <section
      id="what-is"
      aria-labelledby="what-is-heading"
      className="relative py-24"
    >
      <div className="container max-w-3xl">
        <Reveal>
          <h2
            id="what-is-heading"
            className="text-center font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            What is an <span className="text-gradient">AI study assistant</span>?
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="mt-8 space-y-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            <p>
              An AI study assistant is a learning tool that uses artificial
              intelligence to answer questions, explain concepts, and create
              practice material from your own study resources. Instead of
              juggling a chatbot, a quiz maker, and a flashcard app,
              you study in one connected place.
            </p>
            <p>
              StudyAssistant is a free AI study assistant built for students.
              Its AI study buddy, Aeva, answers with live web search and cited
              sources, reads the PDFs and notes you upload, and turns any
              answer or document into quizzes, flashcards, and study plans —
              then tracks your performance so you know what to revise next.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.14}>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li
                key={c.term}
                className="rounded-2xl border border-border/60 bg-card/40 p-4 text-sm leading-relaxed"
              >
                <strong className="font-semibold text-foreground">
                  {c.term}:
                </strong>{" "}
                <span className="text-muted-foreground">{c.detail}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
