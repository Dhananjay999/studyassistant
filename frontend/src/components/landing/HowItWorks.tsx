import {
  BarChart3,
  Bookmark,
  Layers,
  ListChecks,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { Reveal } from "@/components/common/Reveal";

const STEPS = [
  {
    icon: MessageSquare,
    title: "Chat",
    body: "Ask Aeva anything — from your notes, a PDF, or the live web.",
  },
  {
    icon: Layers,
    title: "Flashcards",
    body: "Turn the answer into a flashcard deck and study it your way.",
  },
  {
    icon: ListChecks,
    title: "Quiz",
    body: "Generate a quiz on the same material and test yourself.",
  },
  {
    icon: BarChart3,
    title: "Analysis",
    body: "Get AI performance feedback and see what to revise.",
  },
  {
    icon: Bookmark,
    title: "Bookmark",
    body: "Save the important content into folders for later.",
  },
  {
    icon: RefreshCw,
    title: "Continue",
    body: "Branch a fresh session from any saved item and keep going.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative py-24">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            The complete <span className="text-gradient">learning journey</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            A flow designed to make you actually learn and revise — not just
            chat.
          </p>
        </Reveal>

        <div className="relative mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <div className="flex h-full items-start gap-4 rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white">
                  <s.icon className="h-5 w-5" />
                  <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-background text-[11px] font-bold text-foreground ring-1 ring-border">
                    {i + 1}
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold">
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
