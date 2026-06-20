import { AuroraBackground } from "@/components/common/AuroraBackground";
import { Reveal } from "@/components/common/Reveal";
import { GoogleButton } from "@/components/landing/GoogleButton";

export function CtaBand() {
  return (
    <section className="relative py-20">
      <div className="container">
        <Reveal>
          <div className="glass-strong relative overflow-hidden rounded-3xl px-6 py-16 text-center shadow-glow-lg">
            <AuroraBackground />
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              More than an AI chatbot —{" "}
              <span className="text-gradient">a complete AI learning system.</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Chat, generate flashcards and quizzes, track your progress, and
              keep learning. Start free with Aeva today.
            </p>
            <div className="mt-8 flex justify-center">
              <GoogleButton label="Start learning free" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
