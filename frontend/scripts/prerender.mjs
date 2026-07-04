/**
 * Build-time prerenderer for the public, indexable routes.
 *
 * Runs after both client and SSR builds (see the `build` script in
 * package.json):
 *   1. loads the SSR bundle's `render(path)`,
 *   2. renders each public route to HTML + helmet head tags,
 *   3. injects them into the built dist/index.html template, and
 *   4. writes dist/<route>/index.html (the home route overwrites
 *      dist/index.html itself).
 *
 * Vercel serves these static files before the SPA catch-all rewrite kicks in,
 * so crawlers that don't execute JS (social scrapers, AI answer engines) get
 * real content and correct per-route metadata. Authenticated routes keep the
 * plain SPA template. Also injects a preload for the display font used by the
 * hero heading (LCP element).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const ssrDir = path.join(dist, "server");

const { render, PUBLIC_ROUTES } = await import(
  new URL(`file://${path.join(ssrDir, "entry-server.js")}`).href
);

const SEO_BLOCK = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
const APP_HTML = /<!-- app:start -->[\s\S]*?<!-- app:end -->/;

// Every non-root public route must have an explicit vercel.json rewrite to
// its prerendered file (placed before the /app.html catch-all). Relying on
// implicit directory-index resolution would fail SILENTLY — the route would
// serve the noindexed SPA shell — so a missing rewrite fails the build.
const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
for (const route of PUBLIC_ROUTES) {
  if (route.path === "/") continue;
  const ok = (vercel.rewrites ?? []).some(
    (r) => r.source === route.path && r.destination === `${route.path}/index.html`,
  );
  if (!ok) {
    throw new Error(
      `prerender: vercel.json is missing the rewrite for ${route.path} -> ` +
        `${route.path}/index.html. Add it before the /app.html catch-all.`,
    );
  }
}

let template = readFileSync(path.join(dist, "index.html"), "utf8");
if (!SEO_BLOCK.test(template) || !APP_HTML.test(template)) {
  throw new Error(
    "prerender: index.html is missing the <!-- seo:start/end --> or " +
      "<!-- app:start/end --> markers — refusing to emit unprerendered pages.",
  );
}

// Preload the hero display font (Sora variable) — it renders the LCP heading.
const fontFile = readdirSync(path.join(dist, "assets")).find(
  (f) => /^sora-latin-wght-normal.*\.woff2$/.test(f),
);
if (fontFile) {
  template = template.replace(
    "</head>",
    `  <link rel="preload" href="/assets/${fontFile}" as="font" type="font/woff2" crossorigin>\n  </head>`,
  );
}

// The SPA shell served for authenticated/unknown routes via the Vercel
// catch-all rewrite (vercel.json → /app.html). It keeps the splash and gets
// neutral, noindexed head tags: every route that should be indexed has its
// own prerendered file, and app routes override the head at runtime anyway.
// (The home prerender overwrites dist/index.html, so the catch-all must NOT
// point there — that would flash the landing page inside the app.)
const appShell = template.replace(
  SEO_BLOCK,
  () => `<title>StudyAssistant</title>\n    <meta name="robots" content="noindex" />`,
);
writeFileSync(path.join(dist, "app.html"), appShell);
console.log("wrote SPA shell -> dist/app.html");

for (const route of PUBLIC_ROUTES) {
  const { html, helmet } = render(route.path);
  // `prioritizeSeoTags` (see Seo.tsx) routes canonical/og/description tags
  // into helmet.priority — it must be rendered alongside the regular buckets.
  const head = [
    helmet.title.toString(),
    helmet.priority.toString(),
    helmet.meta.toString(),
    helmet.link.toString(),
    helmet.script.toString(),
  ]
    .filter(Boolean)
    .join("\n    ");

  // Function replacements: literal strings would have `$&`-style sequences
  // inside rendered HTML/JSON-LD interpreted as replacement patterns.
  const page = template
    .replace(SEO_BLOCK, () => head)
    .replace(APP_HTML, () => html);

  const outDir =
    route.path === "/" ? dist : path.join(dist, route.path.slice(1));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "index.html"), page);
  console.log(`prerendered ${route.path} -> ${path.relative(root, outDir)}/index.html`);
}

// The SSR bundle is a build tool, not a deployable artifact.
rmSync(ssrDir, { recursive: true, force: true });
console.log(`prerendered ${PUBLIC_ROUTES.length} routes.`);
