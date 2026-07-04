import {
  Bookmark,
  BarChart3,
  Bot,
  FileText,
  Globe,
  Layers,
  ListChecks,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import { GlassCard } from "@/components/common/GlassCard";
import { Reveal } from "@/components/common/Reveal";

// The headline learning features — given visual prominence. Card headings
// deliberately match what students search for (quiz generator, flashcards…).
const SPOTLIGHT = [
  {
    icon: ListChecks,
    title: "AI Quiz Generator",
    body: "Turn any topic, answer, or PDF into a practice quiz — multiple-choice, multi-select & true/false questions with instant AI grading and feedback.",
  },
  {
    icon: Layers,
    title: "AI Flashcard Generator",
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
    body: "Meet Aeva — your AI tutor for homework help. Ask anything and get clear, streaming answers that pick the right tool automatically.",
  },
  {
    icon: Globe,
    title: "Live Web Search",
    body: "Web-grounded answers with rich source cards, so everything is current and verifiable.",
  },
  {
    icon: FileText,
    title: "Chat with Your PDFs",
    body: "Upload PDFs, notes, and images — Aeva answers from your own material with page-level citations.",
  },
  {
    icon: UserRound,
    title: "Personalized Learning",
    body: "Answers adapt to your education level, language, and preferred explanation style.",
  },
  {
    icon: Bookmark,
    title: "Bookmarks & Folders",
    body: "Save responses, quizzes, and flashcards into folders, then resume learning anytime.",
  },
  {
    icon: Search,
    title: "Global Search",
    body: "Instantly search across chats, quizzes, flashcards, files, and bookmarks.",
  },
];

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="relative py-24"
    >
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2
            id="features-heading"
            className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
          >
            More than a chatbot — a{" "}
            <span className="text-gradient">complete learning system</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Homework help, exam prep, and revision — discover, learn, save, and
            revise in one place.
          </p>
        </Reveal>

        {/* Spotlight: the major learning features */}
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {SPOTLIGHT.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <GlassCard className="group h-full border-brand-1/25 p-6 transition-transform duration-300 hover:-translate-y-1">
                <span className="inline-grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white">
                  <f.icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <h3 className="mt-4 flex items-center gap-1.5 font-display text-lg font-bold">
                  {f.title}
                  <Sparkles
                    className="h-3.5 w-3.5 text-brand-1"
                    aria-hidden="true"
                  />
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
                  <f.icon className="h-5 w-5" aria-hidden="true" />
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
