import type { ReactNode } from "react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

/**
 * Shared shell for public, indexable marketing/legal pages. Reuses the landing
 * Navbar + Footer so every public route shares one chrome, and wraps content in
 * a single semantic <main> with the page's <h1>.
 */
export function PublicPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-background">
      <Navbar />
      <main className="container max-w-3xl pb-24 pt-32 md:pt-40">
        <header className="mb-10">
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            {title}
          </h1>
          {intro && (
            <p className="mt-4 text-lg text-muted-foreground">{intro}</p>
          )}
        </header>
        {children}
      </main>
      <Footer />
    </div>
  );
}
