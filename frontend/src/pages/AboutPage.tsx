import { Seo } from "@/components/common/Seo";
import { PublicPage } from "@/components/landing/PublicPage";
import { GoogleButton } from "@/components/landing/GoogleButton";
import { PAGES, breadcrumbSchema, organizationSchema } from "@/lib/seo";

export default function AboutPage() {
  return (
    <>
      <Seo
        title={PAGES.about.title}
        description={PAGES.about.description}
        keywords={PAGES.about.keywords}
        path={PAGES.about.path}
        jsonLd={[
          organizationSchema(),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "About", path: "/about" },
          ]),
        ]}
      />
      <PublicPage
        title="Study with AI that helps you actually learn"
        intro="StudyAssistant — and Aeva, its AI study buddy — exist to turn answers into understanding."
      >
        <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display">
          <h2>Our mission</h2>
          <p>
            Most AI tools hand students an answer and stop there. We built
            StudyAssistant to do the opposite: help you understand the material,
            practice it, and remember it. Every answer can become a quiz, a
            flashcard deck, or a study plan — so learning doesn't end when the
            chat does.
          </p>

          <h2>How it works</h2>
          <p>
            Chat with Aeva using your own notes and PDFs, or search the live web
            with cited sources. From any response you can generate practice
            quizzes and flashcards, track your performance with AI analysis, and
            save everything with bookmarks and global search. It's one connected
            learning system rather than a pile of separate tools.
          </p>

          <h2>Built for students</h2>
          <p>
            Whether you're preparing for exams, working through homework, or
            reviewing lecture notes, StudyAssistant adapts to how you learn — your
            education level, preferred language, and explanation style shape every
            answer.
          </p>

          <h2>Your data</h2>
          <p>
            Your sessions, uploads, quizzes, and flashcards are tied to your
            account and only accessible to you. Read our{" "}
            <a href="/privacy">Privacy Policy</a> for the details.
          </p>
        </div>
        <div className="mt-12 flex justify-center">
          <GoogleButton label="Start learning free" />
        </div>
      </PublicPage>
    </>
  );
}
