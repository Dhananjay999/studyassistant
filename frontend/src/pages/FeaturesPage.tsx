import {
  BarChart3,
  Bookmark,
  FileText,
  Globe,
  Layers,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Search,
  UserRound,
} from "lucide-react";
import { Seo } from "@/components/common/Seo";
import { PublicPage } from "@/components/landing/PublicPage";
import { GoogleButton } from "@/components/landing/GoogleButton";
import {
  PAGES,
  breadcrumbSchema,
  softwareApplicationSchema,
  webPageSchema,
} from "@/lib/seo";

const FEATURES = [
  {
    icon: MessageSquare,
    title: "AI chat that understands your material",
    body: "Ask Aeva anything and get clear, sourced answers grounded in your own notes, PDFs, and images — not generic guesses. It's an AI tutor that helps with homework at any level.",
  },
  {
    icon: FileText,
    title: "Chat with your PDFs and notes",
    body: "Upload documents and Aeva retrieves the exact pages that answer your question, with page-level citations you can click.",
  },
  {
    icon: Globe,
    title: "Live web search",
    body: "When your notes aren't enough, Aeva searches the web and cites its sources so you can verify every claim.",
  },
  {
    icon: ListChecks,
    title: "One-click AI quiz generator",
    body: "Turn any answer or document into a graded practice quiz. Pick the topic, difficulty, and question types — MCQ, multi-select, or true/false — and get instant AI feedback.",
  },
  {
    icon: Layers,
    title: "Automatic AI flashcards",
    body: "Generate flashcard decks from your material, then flip, shuffle, and rate each card to track your mastery over time.",
  },
  {
    icon: NotebookPen,
    title: "Summaries and study notes",
    body: "Condense chapters, lectures, and long documents into revision-ready notes and summaries — ideal for exam preparation.",
  },
  {
    icon: BarChart3,
    title: "Performance analytics",
    body: "See how you're doing across quizzes and topics, and get AI analysis of exactly what to revise next.",
  },
  {
    icon: UserRound,
    title: "Personalized learning",
    body: "Set your education level, language, and explanation style once — every answer adapts to how you learn.",
  },
  {
    icon: Bookmark,
    title: "Bookmarks and folders",
    body: "Save responses, quizzes, and flashcards into folders and branch a fresh session from any saved item.",
  },
  {
    icon: Search,
    title: "Global search",
    body: "Find anything across your sessions, messages, quizzes, flashcards, and uploads from one fast search bar.",
  },
];

export default function FeaturesPage() {
  return (
    <>
      <Seo
        title={PAGES.features.title}
        description={PAGES.features.description}
        keywords={PAGES.features.keywords}
        path={PAGES.features.path}
        jsonLd={[
          webPageSchema({
            title: PAGES.features.title,
            description: PAGES.features.description,
            path: PAGES.features.path,
          }),
          softwareApplicationSchema(),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Features", path: "/features" },
          ]),
        ]}
      />
      <PublicPage
        title="AI study tools for everything you're learning"
        intro="StudyAssistant is a complete AI study assistant — chat, PDF analysis, quizzes, flashcards, and analytics working together, not a collection of disconnected tools."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="flex h-full flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-6"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient text-white">
                <f.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="font-display text-lg font-semibold">{f.title}</h2>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-12 flex justify-center">
          <GoogleButton label="Start learning free" />
        </div>
      </PublicPage>
    </>
  );
}
