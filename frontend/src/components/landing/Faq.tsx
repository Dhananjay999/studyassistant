import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/common/Reveal";

const FAQS = [
  {
    q: "Is Aeva free to use?",
    a: "Yes — sign in with Google and start asking questions, uploading notes, and generating quizzes right away.",
  },
  {
    q: "What files can I upload?",
    a: "PDFs and images (PNG/JPG/WebP). Aeva reads them and answers questions directly from your material.",
  },
  {
    q: "How are quizzes generated?",
    a: "Pick the number of questions, difficulty, and question types. Aeva builds the quiz from the topic you discussed or from your uploaded document.",
  },
  {
    q: "Does it remember my conversations?",
    a: "Every chat is saved as a session you can revisit. Refresh or come back later and your history is right there.",
  },
  {
    q: "Is my data private?",
    a: "Your sessions and uploads are tied to your account and only accessible to you.",
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
