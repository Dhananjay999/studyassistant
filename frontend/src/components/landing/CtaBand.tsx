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
              Ready to <span className="text-gradient">study smarter?</span>
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Join Aeva and turn your notes into answers and quizzes today.
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
