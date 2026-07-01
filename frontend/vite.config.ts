import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Canonical site origin used for the sitemap + robots. Keep in sync with
// SITE_URL in src/lib/seo.ts.
const SITE_URL = (
  process.env.VITE_SITE_URL ?? "https://studyassistant.app"
).replace(/\/$/, "");

// Public, indexable routes. Adding a public page = add one entry here (mirrors
// the PAGES map in src/lib/seo.ts) and the sitemap picks it up automatically.
const PUBLIC_ROUTES: { path: string; changefreq: string; priority: number }[] = [
  { path: "/", changefreq: "weekly", priority: 1.0 },
  { path: "/features", changefreq: "weekly", priority: 0.9 },
  { path: "/about", changefreq: "monthly", priority: 0.6 },
  { path: "/privacy", changefreq: "yearly", priority: 0.3 },
  { path: "/terms", changefreq: "yearly", priority: 0.3 },
];

// Private/internal path prefixes crawlers must not index.
const DISALLOW = [
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

/**
 * Emits an up-to-date sitemap.xml and robots.txt into the build output at build
 * time, so they grow automatically as public routes are added and never drift
 * from the app's route table.
 */
function seoAssets(): Plugin {
  return {
    name: "seo-assets",
    apply: "build",
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10);
      const urls = PUBLIC_ROUTES.map(
        (r) =>
          `  <url>\n    <loc>${SITE_URL}${r.path}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n` +
          `    <changefreq>${r.changefreq}</changefreq>\n` +
          `    <priority>${r.priority.toFixed(1)}</priority>\n  </url>`,
      ).join("\n");
      const sitemap =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `${urls}\n</urlset>\n`;

      const robots =
        `# https://www.robotstxt.org/robotstxt.html\n` +
        `User-agent: *\n` +
        `Allow: /$\n` +
        PUBLIC_ROUTES.filter((r) => r.path !== "/")
          .map((r) => `Allow: ${r.path}`)
          .join("\n") +
        `\n` +
        DISALLOW.map((p) => `Disallow: ${p}`).join("\n") +
        `\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;

      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    seoAssets(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
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
}));
