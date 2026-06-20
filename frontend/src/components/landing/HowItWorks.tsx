import { MessageSquare, Upload, GraduationCap } from "lucide-react";
import { Reveal } from "@/components/common/Reveal";

const STEPS = [
  {
    icon: MessageSquare,
    title: "Ask",
    body: "Type any question. Aeva picks the right tool — web search or your notes — automatically.",
  },
  {
    icon: Upload,
    title: "Upload",
    body: "Add PDFs or images. Ask questions straight from your own study material.",
  },
  {
    icon: GraduationCap,
    title: "Quiz",
    body: "Generate a practice quiz on the topic, take it, and get instant feedback.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative py-24">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            From question to <span className="text-gradient">mastery</span>
          </h2>
          <p className="mt-4 text-muted-foreground">Three simple steps.</p>
        </Reveal>

        <div className="relative mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1} className="text-center">
              <div className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                <s.icon className="h-7 w-7" />
                <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-background text-xs font-bold text-foreground ring-1 ring-border">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold">
                {s.title}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                {s.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
