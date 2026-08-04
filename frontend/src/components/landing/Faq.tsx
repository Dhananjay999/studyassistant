import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/common/Reveal";

/**
 * Landing-page FAQ. Questions target the long-tail searches students actually
 * type; answers are self-contained (they name the product and stand alone) so
 * search engines and AI answer engines can lift them directly. This list also
 * feeds the FAQPage JSON-LD on the landing page — Google requires the schema
 * text to match the visible text, so edit both together (they share this
 * constant). All items render expanded so every answer is in the DOM.
 */
export const FAQS = [
  {
    q: "What is an AI study assistant?",
    a: "An AI study assistant is a tool that uses artificial intelligence to answer questions, explain concepts, and create practice material from your own study resources. StudyAssistant combines an AI chat, PDF chat, quiz generator, flashcards, spaced-repetition revision, and learning analytics in one free app for students.",
  },
  {
    q: "Is StudyAssistant free?",
    a: "Yes. StudyAssistant is free to start — sign in with Google and begin chatting, uploading notes and PDFs, and generating quizzes and flashcards right away.",
  },
  {
    q: "Can I upload my notes and ask questions?",
    a: "Yes. Upload PDFs, notes, and images and chat with them directly. Aeva, StudyAssistant's AI study buddy, retrieves the exact pages that answer your question and cites them, so you can jump straight to the source in your own material.",
  },
  {
    q: "Can AI generate quizzes from PDFs?",
    a: "Yes. StudyAssistant's AI quiz generator turns any uploaded PDF, note, or chat answer into a practice quiz. Pick the topic, difficulty, and question types; the quiz is graded instantly and you get AI feedback on what to revise.",
  },
  {
    q: "Can I create MCQ quizzes using AI?",
    a: "Yes. StudyAssistant supports multiple-choice (single and multi-select) and true/false questions. Choose the format and difficulty, and the AI builds an MCQ quiz from your material, scores your attempt, and explains the answers.",
  },
  {
    q: "Does StudyAssistant support flashcards?",
    a: "Yes. StudyAssistant auto-generates flashcard decks from responses, documents, or quizzes. Flip and shuffle cards, rate each one Easy, Medium, Hard, or Needs Revision, and track your mastery over time.",
  },
  {
    q: "Can AI summarize my study material?",
    a: "Yes. Ask Aeva to summarize a chapter, lecture slides, or a whole document and it produces revision-ready notes with page citations — useful for condensing long readings before an exam.",
  },
  {
    q: "Can AI help me prepare for exams?",
    a: "Yes. StudyAssistant supports the full exam-prep loop: ask questions, summarize material, generate practice quizzes and flashcards, and review AI performance analysis that shows exactly which topics need more revision.",
  },
  {
    q: "Does StudyAssistant help me revise with spaced repetition?",
    a: "Yes. AI Revision Mode tracks a memory-strength score for every topic you study and schedules reviews just before you're likely to forget. Your revision dashboard shows what needs immediate revision, what's due today, and what you've recently mastered — each with a reason, like “You scored 58% on this 3 days ago” — and one tap starts a revision session, quiz, or flashcard review. After each session, a quick confidence check-in reschedules the topic.",
  },
  {
    q: "Does StudyAssistant adapt to how I learn?",
    a: "Yes. An optional learning profile — your education level, preferred language, and explanation style — personalizes every answer, so explanations match how you actually study.",
  },
  {
    q: "What subjects does StudyAssistant cover?",
    a: "Any subject. Students use StudyAssistant for biology, calculus, physics, chemistry, history, economics, literature, computer science, and more — it works from your own material, so it covers whatever you're studying.",
  },
  {
    q: "Can I organize my study by subject?",
    a: "Yes. Study Spaces are per-subject workspaces that keep your chats, notes, quizzes, flashcards, and files together. Each space tracks its own progress and weak topics, so you always know where you stand in every subject.",
  },
  {
    q: "Can I share quizzes and notes with friends?",
    a: "Yes. StudyAssistant creates public links for quizzes, quiz results, and notes. Friends can attempt a shared quiz without creating an account, so it works for group revision and comparing results.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Your sessions, uploads, quizzes, and flashcards are tied to your account and only accessible to you. Read the privacy policy for details on how data is handled.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="relative py-24">
      <div className="container max-w-3xl">
        <Reveal className="text-center">
          <h2
            id="faq-heading"
            className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Frequently asked <span className="text-gradient">questions</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          {/* Closed by default, one open at a time. `forceMount` keeps every
              answer in the DOM (collapsed Radix items unmount their content,
              which would hide the text from crawlers and break FAQPage schema
              parity); the arbitrary variant hides closed panels visually. */}
          <Accordion
            type="single"
            collapsible
            className="w-full [&_[role=region][data-state=closed]]:hidden"
          >
            {FAQS.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent forceMount className="text-muted-foreground">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
