import { Seo } from "@/components/common/Seo";
import { IntroLoader } from "@/components/common/IntroLoader";
import { Navbar } from "@/components/landing/Navbar";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Faq } from "@/components/landing/Faq";
import { CtaBand } from "@/components/landing/CtaBand";
import { Footer } from "@/components/landing/Footer";

export default function LandingPage() {
  return (
    <>
      <Seo
        title="StudyAssistant — a complete AI learning system, not just a chatbot"
        description="StudyAssistant (meet Aeva) is a complete AI learning system for students: chat with web search and your PDFs, auto-generate flashcards and quizzes, get AI performance analysis, and save everything with bookmarks and global search. Free to start."
        path="/"
      />
      <IntroLoader onDone={() => undefined} />
      <div className="relative min-h-dvh bg-background">
        <Navbar />
        <main>
          <Hero />
          <Features />
          <HowItWorks />
          <Faq />
          <CtaBand />
        </main>
        <Footer />
      </div>
    </>
  );
}
