// Plain-text previews of markdown content for surfaces that show a short,
// clamped snippet (bookmark cards, search hits). Rendering the snippet as
// markdown is overkill there, but showing the raw source leaks `**`, `##`,
// table pipes and code fences into the preview.

/** Strip markdown syntax, keeping the readable text on one line. */
export function markdownToPlain(input: string, maxLength = 300): string {
  if (!input) return "";
  // A clamped preview only ever shows the first few lines; don't scan a
  // whole saved answer.
  const s = input
    .slice(0, maxLength * 4)
    // Fenced code: keep the code, drop the fences and language tag.
    .replace(/```[^\n]*\n?/g, "")
    // Images and links: keep the label.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Inline citation markers.
    .replace(/\[cite:[^\]]*\]/g, "")
    // Table separator rows, then the pipes of the remaining rows.
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\s*\|\s*/g, " ")
    // Line-leading markers: headings, blockquotes, list bullets/numbers.
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    // Emphasis, strikethrough, inline code and math delimiters.
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[\s(])[*_](\S(?:[^*_\n]*\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\${1,2}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s.length > maxLength ? `${s.slice(0, maxLength).trimEnd()}…` : s;
}
