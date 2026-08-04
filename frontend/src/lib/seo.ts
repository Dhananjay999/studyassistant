/**
 * Central SEO configuration and structured-data helpers.
 *
 * Site-wide constants, per-page metadata, and the JSON-LD builders used by the
 * `Seo` component. Route metadata itself lives in `seo-routes.ts` (a pure,
 * env-free module) so `vite.config.ts` can share it for the sitemap,
 * robots.txt, llms.txt, and the prerender route list.
 */

import { PAGES, SITE_NAME } from "@/lib/seo-routes";

export {
  BRAND,
  CORE_KEYWORDS,
  PAGES,
  PUBLIC_ROUTES,
  SITE_NAME,
  TWITTER_HANDLE,
  type PageMeta,
} from "@/lib/seo-routes";

/** Canonical origin (no trailing slash). Override with VITE_SITE_URL. */
export const SITE_URL = (
  import.meta.env.VITE_SITE_URL ?? "https://studyassistant.app"
).replace(/\/$/, "");

/** Default social preview image (absolute URL, 1200×630 PNG). */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Default alt text for the social preview image. */
export const DEFAULT_OG_IMAGE_ALT =
  "StudyAssistant — a complete AI learning system for students";

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path = "/"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${clean === "/" ? "/" : clean.replace(/\/$/, "")}`;
}

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
    // Google wants a raster logo of at least 112×112px.
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/icon-512.png`,
      width: 512,
      height: 512,
    },
    description:
      "AI study assistant for students: chat with your PDFs, auto-generate quizzes and flashcards, and revise with AI spaced repetition.",
  };
}

/** WebSite node — site identity for search engines. */
export function websiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description:
      "A complete AI learning system for students — chat, quizzes, flashcards, spaced-repetition revision, and analytics.",
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
    screenshot: `${SITE_URL}/og-image.png`,
    featureList: [
      "AI revision mode with topic-level spaced repetition",
      "Memory-strength tracking with reasons and one-tap revision actions",
      "Study streaks and post-session confidence check-ins",
      "AI chat with web search and cited sources",
      "Chat with PDFs, notes, and images (page-level citations)",
      "AI quiz generator with instant grading and feedback",
      "AI flashcard generator with mastery tracking",
      "Study spaces — per-subject workspaces with progress tracking",
      "Markdown notes editor with PDF export and sharing",
      "Public sharing of quizzes, quiz results, and notes",
      "AI-generated diagrams and images in answers",
      "Analytics dashboard: study time, streaks, quiz trends, achievements",
      "Personalized explanations from your learning profile",
      "Bookmarks, folders, and global search",
    ],
  };
}

/** WebPage node — identifies a specific public page within the site graph. */
export function webPageSchema(opts: {
  title: string;
  description: string;
  path: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${absoluteUrl(opts.path)}#webpage`,
    url: absoluteUrl(opts.path),
    name: opts.title,
    description: opts.description,
    isPartOf: { "@id": `${SITE_URL}/#website` },
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

/** BreadcrumbList node — used on every public subpage. */
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
    author: opts.author
      ? { "@type": "Person", name: opts.author }
      : { "@type": "Organization", name: SITE_NAME },
    publisher: { "@id": `${SITE_URL}/#organization` },
    datePublished: opts.publishedAt,
    dateModified: opts.updatedAt ?? opts.publishedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(opts.path) },
  };
}
