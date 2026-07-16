import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import {
  DISALLOWED_PREFIXES,
  PUBLIC_ROUTES,
  SITE_NAME,
} from "./src/lib/seo-routes";

/**
 * AI/answer-engine crawlers we explicitly welcome (the product's discovery
 * strategy includes AI search). Each gets its own robots.txt group mirroring
 * the generic rules — a UA-specific group replaces `*` entirely, so the
 * private-route disallows must be repeated per group.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "meta-externalagent",
];

/**
 * Emits sitemap.xml, robots.txt, and llms.txt into the build output. Route
 * metadata comes from src/lib/seo-routes.ts (shared with the app), so the
 * files grow automatically as public routes are added and never drift from
 * the app's route table. `<lastmod>` is intentionally omitted — stamping the
 * build date on every deploy tells crawlers pages changed when they didn't.
 */
function seoAssets(siteUrl: string): Plugin {
  return {
    name: "seo-assets",
    apply: "build",
    generateBundle() {
      const urls = PUBLIC_ROUTES.map(
        (r) =>
          `  <url>\n    <loc>${siteUrl}${r.path}</loc>\n` +
          `    <changefreq>${r.changefreq}</changefreq>\n` +
          `    <priority>${(r.priority ?? 0.5).toFixed(1)}</priority>\n  </url>`,
      ).join("\n");
      const sitemap =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `${urls}\n</urlset>\n`;

      const group = (ua: string) =>
        `User-agent: ${ua}\nAllow: /\n` +
        DISALLOWED_PREFIXES.map((p) => `Disallow: ${p}`).join("\n");
      const robots =
        `${group("*")}\n\n` +
        `# AI assistants and answer engines are welcome to read public pages.\n` +
        AI_CRAWLERS.map(group).join("\n\n") +
        `\n\nSitemap: ${siteUrl}/sitemap.xml\n`;

      const llms =
        `# ${SITE_NAME}\n\n` +
        `> ${SITE_NAME} is a free AI study assistant for students. ` +
        `Its assistant, Aeva, answers questions with live web search, chats ` +
        `with uploaded PDFs, notes, and images (with page-level citations), ` +
        `and turns any topic or document into practice quizzes, flashcards, ` +
        `and study plans with AI performance analysis.\n\n` +
        `Key facts:\n` +
        `- Pricing: free to start; sign in with Google.\n` +
        `- Platform: web app (installable PWA).\n` +
        `- Core tools: AI chat, chat with PDF, AI quiz generator (single/multi ` +
        `choice and true-false questions with instant grading), AI flashcard ` +
        `generator with mastery tracking, learning analytics, bookmarks, and ` +
        `global search.\n` +
        `- Personalization: answers adapt to the student's education level, ` +
        `language, and preferred explanation style.\n` +
        `- Privacy: a student's sessions, uploads, quizzes, and flashcards ` +
        `are private to their account.\n\n` +
        `## Pages\n\n` +
        PUBLIC_ROUTES.map(
          (r) => `- [${r.title}](${siteUrl}${r.path}): ${r.description}`,
        ).join("\n") +
        `\n`;

      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots });
      this.emitFile({ type: "asset", fileName: "llms.txt", source: llms });
    },
  };
}

/**
 * Injects search-console verification metas from env vars (set them in the
 * deployment environment, never hardcoded): VITE_GSC_VERIFICATION (Google
 * Search Console) and VITE_BING_VERIFICATION (Bing Webmaster Tools).
 */
function verificationMeta(env: Record<string, string>): Plugin {
  return {
    name: "verification-meta",
    transformIndexHtml() {
      const tags = [];
      if (env.VITE_GSC_VERIFICATION) {
        tags.push({
          tag: "meta",
          attrs: {
            name: "google-site-verification",
            content: env.VITE_GSC_VERIFICATION,
          },
          injectTo: "head" as const,
        });
      }
      if (env.VITE_BING_VERIFICATION) {
        tags.push({
          tag: "meta",
          attrs: { name: "msvalidate.01", content: env.VITE_BING_VERIFICATION },
          injectTo: "head" as const,
        });
      }
      return tags;
    },
  };
}

/** Short commit SHA of the working tree, or "" outside a git checkout. */
function localGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Version/build stamping for the About screen (never hardcoded in src):
  // version from package.json, build id from CI (Vercel commit SHA) or the
  // local git checkout, environment from the deploy target.
  const pkg = JSON.parse(
    readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
  ) as { version: string };
  const buildId =
    env.VITE_BUILD_ID ||
    (env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) ||
    localGitSha() ||
    "local";
  // Canonical site origin used for sitemap/robots/llms.txt. Keep in sync with
  // SITE_URL in src/lib/seo.ts (both default to the same origin).
  const siteUrl = (env.VITE_SITE_URL ?? "https://studyassistant.app").replace(
    /\/$/,
    "",
  );

  return {
    define: {
      __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || pkg.version),
      __BUILD_ID__: JSON.stringify(buildId),
      __BUILD_ENV__: JSON.stringify(env.VERCEL_ENV || mode),
    },
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      // The SSR pass only feeds scripts/prerender.mjs — emit the SEO assets
      // and verification metas once, from the client build.
      !isSsrBuild && seoAssets(siteUrl),
      !isSsrBuild && verificationMeta(env),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Bundle every dependency into the prerender entry so node never has to
    // resolve CJS/ESM interop for client-oriented packages at run time.
    ssr: isSsrBuild ? { noExternal: true } : undefined,
    build: isSsrBuild
      ? {
          outDir: "dist/server",
          emptyOutDir: true,
        }
      : {
          chunkSizeWarningLimit: 900,
          rollupOptions: {
            output: {
              // Keep heavy, chat-only libraries out of the landing's initial load.
              manualChunks: {
                "react-vendor": ["react", "react-dom", "react-router-dom"],
                motion: ["framer-motion"],
                pdf: ["react-pdf"],
                markdown: ["react-markdown", "katex", "react-katex"],
              },
            },
          },
        },
  };
});
