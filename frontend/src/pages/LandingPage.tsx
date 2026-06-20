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
        title="StudyAssistant — AI study buddy that turns notes into answers & quizzes"
        description="StudyAssistant is an AI study buddy (meet Aeva) for students. Ask any question, upload your PDFs and notes for instant answers, and auto-generate practice quizzes. Free to start."
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
