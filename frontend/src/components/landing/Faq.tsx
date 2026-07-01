import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/common/Reveal";

export const FAQS = [
  {
    q: "Is Aeva free to use?",
    a: "Yes — sign in with Google and start chatting, uploading notes, and generating quizzes and flashcards right away.",
  },
  {
    q: "What can Aeva create from my material?",
    a: "From any answer, PDF, or image, Aeva can generate practice quizzes and flashcard decks, write study plans, and analyze your quiz performance.",
  },
  {
    q: "How do flashcards work?",
    a: "Aeva builds a deck with a question on the front and the answer on the back. Flip, shuffle, and rate each card Easy / Medium / Hard / Needs Revision — your mastery is tracked over time.",
  },
  {
    q: "How are quizzes generated and graded?",
    a: "Pick the topic, difficulty, and question types. Aeva builds the quiz from your conversation or uploaded document, scores it instantly, and gives AI feedback on what to revise.",
  },
  {
    q: "Can I save and revisit content?",
    a: "Bookmark responses, quizzes, and flashcards into folders, search everything from global search, and continue learning by branching a fresh session from any saved item.",
  },
  {
    q: "Is my data private?",
    a: "Your sessions, uploads, quizzes, and flashcards are tied to your account and only accessible to you.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative py-24">
      <div className="container max-w-3xl">
        <Reveal className="text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Frequently asked <span className="text-gradient">questions</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((f, i) => (
              <AccordionItem key={f.q} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
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
