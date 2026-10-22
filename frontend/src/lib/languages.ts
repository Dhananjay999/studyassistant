// Languages a student can pick for one message in the composer chip. The
// profile's response language stays the default; a pick applies to that turn
// (and to any quiz, flashcards or notes made from it). Indian languages first:
// 18 of 80 profiles chose a non-English language and Hinglish leads.

export const TURN_LANGUAGES: readonly string[] = [
  "English",
  "Hinglish",
  "Hindi",
  "Bengali",
  "Marathi",
  "Tamil",
  "Telugu",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Odia",
  "Urdu",
  "Arabic",
  "French",
  "Spanish",
];

/** Two-letter badge for the chip when a language is active. */
export function languageBadge(language: string): string {
  const special: Record<string, string> = { Hinglish: "HI+", English: "EN" };
  return special[language] ?? language.slice(0, 2).toUpperCase();
}

const KEY = "aeva_turn_language";

/** Per-tab memory of the chip so a reload keeps the student's choice. */
export function readTurnLanguage(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && TURN_LANGUAGES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeTurnLanguage(language: string | null): void {
  try {
    if (language) sessionStorage.setItem(KEY, language);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts for this page load */
  }
}
