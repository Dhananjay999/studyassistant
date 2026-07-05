// Sharing helpers: the Web Share API (native OS sheet on mobile) with a
// desktop fallback of per-platform share-intent URLs.

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

/** Open the native share sheet if available. Resolves true when the share UI
 * was shown (or completed), false when unsupported so callers can fall back to
 * the dialog. Cancels are treated as handled (true) — the user saw the sheet. */
export async function nativeShare(data: ShareData): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  try {
    await navigator.share(data);
    return true;
  } catch (err) {
    // AbortError = the user dismissed the sheet; still "handled".
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
}

export type SharePlatform =
  | "whatsapp"
  | "linkedin"
  | "twitter"
  | "facebook"
  | "telegram"
  | "email";

/** Per-platform share-intent URLs for the desktop dialog. */
export function buildShareLinks(
  url: string,
  text: string,
): Record<SharePlatform, string> {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const tu = encodeURIComponent(`${text} ${url}`);
  return {
    whatsapp: `https://wa.me/?text=${tu}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    twitter: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    email: `mailto:?subject=${t}&body=${tu}`,
  };
}
