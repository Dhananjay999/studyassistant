// Inline citation support. The media tool emits self-describing markers of the
// form `[cite:<document name>#<page>]` right where it uses a source. We turn
// those into markdown links with a private `aeva-cite:` scheme so ReactMarkdown
// keeps them inline; a custom link renderer then swaps each one for a compact,
// clickable chip (see ChatMessages).

import { defaultUrlTransform } from "react-markdown";

export const CITE_SCHEME = "aeva-cite:";

// [cite:Name] or [cite:Name#12]. Name stops at the first `#` or `]`.
const CITE_RE = /\[cite:\s*([^\]#]+?)\s*(?:#\s*(\d+))?\s*\]/g;

// One markdown link, and a parenthesized group of one or more of them —
// the "(...)" wrapper models love to put around web citations. Stripping it
// lets the chips sit inline without doubled-up punctuation.
const MD_LINK = String.raw`\[[^\]]*\]\([^)\s]+\)`;
const PAREN_LINKS_RE = new RegExp(
  String.raw`\(\s*(${MD_LINK}(?:\s*[,;]?\s*${MD_LINK})*)\s*\)`,
  "g",
);

/** Rewrite `[cite:Name#page]` markers into `aeva-cite:` markdown links, and
 * drop the parentheses the model wraps around inline web citations. */
export function preprocessCitations(markdown: string): string {
  return markdown
    .replace(PAREN_LINKS_RE, " $1")
    .replace(CITE_RE, (_full, rawName: string, page?: string) => {
      const name = rawName.trim();
      const label = page ? `${name} · p.${page}` : name;
      const target =
        `${CITE_SCHEME}${encodeURIComponent(name)}` + (page ? `|${page}` : "");
      return `[${label}](${target})`;
    });
}

/** Decode an `aeva-cite:` href back into its document name + page. */
export function parseCiteTarget(
  href: string,
): { name: string; page?: number } | null {
  if (!href.startsWith(CITE_SCHEME)) return null;
  const raw = href.slice(CITE_SCHEME.length);
  const [encoded, pageStr] = raw.split("|");
  return {
    name: decodeURIComponent(encoded),
    page: pageStr ? Number(pageStr) : undefined,
  };
}

/** Allow our private citation scheme through; sanitize everything else. */
export function citationUrlTransform(url: string): string {
  return url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url);
}
