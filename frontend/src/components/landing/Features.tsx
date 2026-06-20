import {
  Bookmark,
  BarChart3,
  Bot,
  FileText,
  Globe,
  Layers,
  ListChecks,
  MessageCircleQuestion,
  Search,
  Sparkles,
} from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Reveal } from "@/components/common/Reveal";

// The headline learning features — given visual prominence.
const SPOTLIGHT = [
  {
    icon: ListChecks,
    title: "Quiz Generation",
    body: "Turn any topic, answer, or document into a practice quiz with single, multi & true/false questions — then get instant AI scoring.",
  },
  {
    icon: Layers,
    title: "Flashcard Generation",
    body: "Auto-generate flashcard decks from responses, PDFs, or quizzes. Flip, shuffle, and study with Easy / Hard / Needs-Revision ratings.",
  },
  {
    icon: BarChart3,
    title: "Learning Analytics",
    body: "AI performance analysis after every quiz, plus mastery and revision tracking across all your flashcards and study sessions.",
  },
];

const FEATURES = [
  {
    icon: Bot,
    title: "AI Chat Assistant",
    body: "Meet Aeva — ask anything and get clear, streaming answers that pick the right tool automatically.",
  },
  {
    icon: Globe,
    title: "Web-grounded search",
    body: "Live web search with rich source cards so every answer is current and verifiable.",
  },
  {
    icon: FileText,
    title: "PDF & image analysis",
    body: "Upload PDFs and images — Aeva reads them and answers from your own material.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Smart clarifications",
    body: "When a request is ambiguous, Aeva asks a quick question instead of guessing.",
  },
  {
    icon: Bookmark,
    title: "Bookmarks & folders",
    body: "Save responses, quizzes, and flashcards into folders, then resume learning anytime.",
  },
  {
    icon: Search,
    title: "Global search",
    body: "Instantly search across chats, quizzes, flashcards, files, and bookmarks.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-24">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            More than a chatbot — a{" "}
            <span className="text-gradient">complete learning system</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Discover, learn, save, and revise — all in one place.
          </p>
        </Reveal>

        {/* Spotlight: the major learning features */}
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {SPOTLIGHT.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <GlassCard className="group h-full border-brand-1/25 p-6 transition-transform duration-300 hover:-translate-y-1">
                <span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white">
                  <f.icon className="h-6 w-6" />
                </span>
                <h3 className="mt-4 flex items-center gap-1.5 font-display text-lg font-bold">
                  {f.title}
                  <Sparkles className="h-3.5 w-3.5 text-brand-1" />
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>

        {/* Supporting features */}
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05}>
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
