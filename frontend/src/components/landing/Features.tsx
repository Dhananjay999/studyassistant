import {
  Globe,
  FileText,
  ListChecks,
  MessageCircleQuestion,
  History,
  Sparkles,
} from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Reveal } from "@/components/common/Reveal";

const FEATURES = [
  {
    icon: Globe,
    title: "Web-grounded answers",
    body: "Ask anything and get clear, sourced answers powered by live web search.",
  },
  {
    icon: FileText,
    title: "Chat with your notes",
    body: "Upload PDFs and images — Aeva reads them and answers from your material.",
  },
  {
    icon: ListChecks,
    title: "Instant practice quizzes",
    body: "Turn any topic or document into a custom quiz with single, multi & true/false.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Smart clarifications",
    body: "When a request is ambiguous, Aeva asks a quick question instead of guessing.",
  },
  {
    icon: History,
    title: "Saved sessions",
    body: "Every conversation is saved and resumable — pick up exactly where you left off.",
  },
  {
    icon: Sparkles,
    title: "Live streaming replies",
    body: "Answers stream in token-by-token so you never stare at a blank screen.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-24">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to <span className="text-gradient">ace it</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            One study buddy for questions, notes, and exam prep.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06}>
              <GlassCard className="group h-full p-6 transition-transform duration-300 hover:-translate-y-1">
                <span className="inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-1/15 text-brand-1 transition-colors group-hover:bg-brand-1/25">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
