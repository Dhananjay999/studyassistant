/**
 * Central SEO configuration and structured-data helpers.
 *
 * Single source of truth for site-wide constants, per-page metadata, and the
 * JSON-LD builders used by the `Seo` component. Public routes listed here should
 * mirror the sitemap route list in `vite.config.ts` (kept in sync by hand — a
 * new public page needs an entry in both places).
 */

/** Canonical origin (no trailing slash). Override with VITE_SITE_URL. */
export const SITE_URL = (
  import.meta.env.VITE_SITE_URL ?? "https://studyassistant.app"
).replace(/\/$/, "");

export const SITE_NAME = "StudyAssistant";
export const BRAND = "Aeva";
export const TWITTER_HANDLE = "@studyassistant";

/** Default social preview image (absolute URL). */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.svg`;

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean === "/" ? "/" : clean.replace(/\/$/, "")}`;
}

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
  "AI learning platform",
  "AI homework helper",
  "AI quiz generator",
  "AI flashcards",
  "study with AI",
  "PDF AI chat",
  "student AI assistant",
  "AI tutor",
  "exam prep",
];

/**
 * Per-page SEO metadata for every public, indexable page. Authenticated app
 * pages are intentionally absent — they render `<Seo noindex />` instead.
 */
export const PAGES = {
  home: {
    path: "/",
    title: `${SITE_NAME} — a complete AI learning system, not just a chatbot`,
    description:
      "StudyAssistant (meet Aeva) is a complete AI learning system for students: chat with web search and your PDFs, auto-generate flashcards and quizzes, get AI performance analysis, and save everything with bookmarks and global search. Free to start.",
    keywords: CORE_KEYWORDS,
    changefreq: "weekly",
    priority: 1.0,
  },
  features: {
    path: "/features",
    title: `Features — ${SITE_NAME} AI study tools for students`,
    description:
      "Explore StudyAssistant's features: AI chat over your PDFs and notes, live web search, one-click quiz and flashcard generation, performance analytics, bookmarks, and global search.",
    keywords: [
      "AI study tools",
      "AI quiz generator",
      "AI flashcards",
      "PDF AI chat",
      "study analytics",
      ...CORE_KEYWORDS,
    ],
    changefreq: "weekly",
    priority: 0.9,
  },
  about: {
    path: "/about",
    title: `About ${SITE_NAME} — the AI study buddy for students`,
    description:
      "Learn about StudyAssistant and Aeva, the AI study buddy built to help students actually learn — not just get answers. Our mission, approach, and how we handle your data.",
    keywords: ["about StudyAssistant", "AI study buddy", "student AI assistant"],
    changefreq: "monthly",
    priority: 0.6,
  },
  privacy: {
    path: "/privacy",
    title: `Privacy Policy — ${SITE_NAME}`,
    description:
      "How StudyAssistant collects, uses, and protects your data. Your sessions, uploads, quizzes, and flashcards are tied to your account and only accessible to you.",
    changefreq: "yearly",
    priority: 0.3,
  },
  terms: {
    path: "/terms",
    title: `Terms of Service — ${SITE_NAME}`,
    description:
      "The terms that govern your use of StudyAssistant. Read our acceptable-use policy, account rules, and service terms.",
    changefreq: "yearly",
    priority: 0.3,
  },
} satisfies Record<string, PageMeta>;

/** Every public, indexable route (for internal use / cross-checks). */
export const PUBLIC_ROUTES: PageMeta[] = Object.values(PAGES);

/* --------------------------------------------------------------------------
 * JSON-LD structured-data builders.
 * Each returns a plain object serialized into a <script type="application/ld+json">.
 * ------------------------------------------------------------------------ */

/** Organization node — powers the knowledge panel / brand recognition. */
export function organizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    description:
      "AI study assistant for students: chat with your PDFs, search the web, and auto-generate quizzes and flashcards.",
    sameAs: [] as string[],
  };
}

/** WebSite node — enables the sitelinks search box and site identity. */
export function websiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description:
      "A complete AI learning system for students — chat, quizzes, flashcards, and analytics.",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** SoftwareApplication node — rich result for the product itself. */
export function softwareApplicationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "AI study buddy for students: ask questions, upload notes/PDFs for instant answers, search the web, and generate practice quizzes and flashcards.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

/** FAQPage node from a list of Q/A pairs (landing-page FAQ). */
export function faqSchema(
  faqs: { q: string; a: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** BreadcrumbList node (future-ready, e.g. for blog articles). */
export function breadcrumbSchema(
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Article node — future-ready for the blog. */
export function articleSchema(opts: {
  title: string;
  description: string;
  path: string;
  image?: string;
  author?: string;
  publishedAt?: string;
  updatedAt?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.description,
    image: opts.image ?? DEFAULT_OG_IMAGE,
    author: { "@type": "Person", name: opts.author ?? SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.svg` },
    },
    datePublished: opts.publishedAt,
    dateModified: opts.updatedAt ?? opts.publishedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(opts.path) },
  };
}
