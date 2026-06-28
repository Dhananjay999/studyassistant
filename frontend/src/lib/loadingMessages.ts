// Centralized, AI-first loading copy so every surface speaks the same language.

// Staged copy for the post-Google sign-in handoff (the redirect overlay).
export const AUTH_MESSAGES = [
  "Signing you in…",
  "Verifying your account…",
  "Preparing your workspace…",
];

export const APP_BOOT_MESSAGES = [
  "Preparing your learning workspace…",
  "Setting things up for you…",
  "Organizing your study materials…",
  "Aeva is getting ready…",
  "Loading your conversations…",
  "Warming up the study engine…",
  "Tidying your bookmarks…",
  "Lining up your flashcards…",
  "Dusting off your quizzes…",
  "Syncing your progress…",
  "Gathering your notes…",
  "Tuning Aeva's brain…",
  "Polishing the details…",
  "Loading your learning history…",
  "Getting your materials in order…",
  "Almost ready…",
  "Just a moment…",
  "Thanks for your patience…",
  "Putting on the finishing touches…",
  "Here we go…",
];

export type ThinkingHint =
  | "thinking"
  | "web"
  | "media"
  | "quiz"
  | "flashcard";

export interface ProgressiveStep {
  /** Milliseconds after start at which this message appears. */
  at: number;
  text: string;
}

// Progressive (not rapid-cycling) thinking copy, revealed on a widening cadence.
export const THINKING_PROGRESSIONS: Record<ThinkingHint, ProgressiveStep[]> = {
  thinking: [
    { at: 0, text: "Understanding your question…" },
    { at: 2000, text: "Reviewing available context…" },
    { at: 5000, text: "Gathering information…" },
    { at: 8000, text: "Generating the best response…" },
    { at: 12000, text: "Almost there…" },
  ],
  web: [
    { at: 0, text: "Understanding your question…" },
    { at: 2000, text: "Searching trusted sources…" },
    { at: 5000, text: "Reading the results…" },
    { at: 8000, text: "Generating the best response…" },
    { at: 12000, text: "Almost there…" },
  ],
  media: [
    { at: 0, text: "Reading your files…" },
    { at: 2000, text: "Reviewing the material…" },
    { at: 5000, text: "Pulling out the key details…" },
    { at: 8000, text: "Generating the best response…" },
    { at: 12000, text: "Almost there…" },
  ],
  quiz: [
    { at: 0, text: "Understanding the topic…" },
    { at: 2000, text: "Reviewing the context…" },
    { at: 5000, text: "Writing questions…" },
    { at: 8000, text: "Building your quiz…" },
    { at: 12000, text: "Almost there…" },
  ],
  flashcard: [
    { at: 0, text: "Understanding the topic…" },
    { at: 2000, text: "Reviewing the context…" },
    { at: 5000, text: "Distilling the key ideas…" },
    { at: 8000, text: "Creating your flashcards…" },
    { at: 12000, text: "Almost there…" },
  ],
};
