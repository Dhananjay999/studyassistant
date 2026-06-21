// Clipboard helpers that copy *rendered* content, not raw markdown.

/** Best-effort markdown → readable plain text (fallback when no DOM node). */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Copy with the best available strategy: rich (text/html + text/plain) when the
 * browser supports it, otherwise plain text. Returns true on success.
 */
export async function copyRich({
  html,
  text,
}: {
  html?: string;
  text: string;
}): Promise<boolean> {
  try {
    if (
      html &&
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard?.write
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
