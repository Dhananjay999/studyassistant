/**
 * Pure, environment-free SEO route metadata.
 *
 * The single source of truth for every public, indexable page. Imported by BOTH
 * the app (`src/lib/seo.ts`, page components) and `vite.config.ts` (sitemap,
 * robots.txt, llms.txt, prerender route list), so it must stay free of
 * `import.meta.env` and any browser/Vite-only APIs.
 */

export const SITE_NAME = "StudyAssistant";
export const BRAND = "Aeva";
export const TWITTER_HANDLE = "@studyassistant";

/** Shape of the per-page metadata used across public pages. */
export interface PageMeta {
  path: string;
  title: string;
  description: string;
  keywords?: string[];
  /** Sitemap change frequency + priority hints. */
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

/** Keyword clusters we want the landing/product to rank for. */
export const CORE_KEYWORDS = [
  "AI study assistant",
  "AI study buddy",
  "AI learning platform",
  "AI homework helper",
  "AI quiz generator",
  "AI flashcards",
  "AI tutor",
  "chat with PDF AI",
  "AI notes generator",
  "AI exam preparation",
  "AI for students",
  "best AI study app",
];

/**
 * Per-page SEO metadata for every public, indexable page. Authenticated app
 * pages are intentionally absent — they render `<Seo noindex />` instead.
 * Titles stay under ~60 chars and descriptions under ~160 so neither is
 * truncated in search results.
 */
export const PAGES = {
  home: {
    path: "/",
    title: `${SITE_NAME} — Free AI Study Assistant & Study Buddy`,
    description:
      "StudyAssistant is a free AI study assistant for students. Chat with " +
      "your PDFs, search the web, and turn any topic into quizzes, " +
      "flashcards, and study plans.",
    keywords: CORE_KEYWORDS,
    changefreq: "weekly",
    priority: 1.0,
  },
  features: {
    path: "/features",
    title: `AI Quiz Generator, Flashcards & PDF Chat — ${SITE_NAME}`,
    description:
      "Explore StudyAssistant's AI study tools: chat with PDFs and notes, " +
      "live web search, one-click quiz and flashcard generation, learning " +
      "analytics, and global search.",
    // CORE_KEYWORDS already covers quiz generator / flashcards — only the
    // page-specific extras are listed here to avoid duplicate terms.
    keywords: ["AI study tools", "PDF AI chat", "study analytics", ...CORE_KEYWORDS],
    changefreq: "weekly",
    priority: 0.9,
  },
  about: {
    path: "/about",
    title: `About ${SITE_NAME} — the AI Study Buddy for Students`,
    description:
      "Learn about StudyAssistant and Aeva, the AI study buddy that helps " +
      "students actually learn. Our mission, how it works, and how we " +
      "handle your data.",
    keywords: ["about StudyAssistant", "AI study buddy", "student AI assistant"],
    changefreq: "monthly",
    priority: 0.6,
  },
  privacy: {
    path: "/privacy",
    title: `Privacy Policy — ${SITE_NAME}`,
    description:
      "How StudyAssistant collects, uses, and protects your data. Your " +
      "sessions, uploads, quizzes, and flashcards are tied to your account " +
      "and only accessible to you.",
    changefreq: "yearly",
    priority: 0.3,
  },
  terms: {
    path: "/terms",
    title: `Terms of Service — ${SITE_NAME}`,
    description:
      "The terms that govern your use of StudyAssistant. Read our " +
      "acceptable-use policy, account rules, and service terms.",
    changefreq: "yearly",
    priority: 0.3,
  },
} satisfies Record<string, PageMeta>;

/** Every public, indexable route (sitemap, robots, llms.txt, prerender). */
export const PUBLIC_ROUTES: PageMeta[] = Object.values(PAGES);

/** Private/internal path prefixes crawlers must not crawl or index. */
export const DISALLOWED_PREFIXES = [
  "/chat",
  "/bookmarks",
  "/quizzes",
  "/flashcards",
  "/analytics",
  "/files",
  "/admin",
  "/auth",
  "/api",
];
