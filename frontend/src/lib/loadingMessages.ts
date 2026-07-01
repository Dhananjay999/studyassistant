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
// Each workflow gets its own emoji-led narration so the wait feels purposeful
// and specific to what Aeva is actually doing.
export const THINKING_PROGRESSIONS: Record<ThinkingHint, ProgressiveStep[]> = {
  thinking: [
    { at: 0, text: "🤔 Understanding your question…" },
    { at: 2000, text: "🧠 Thinking it through…" },
    { at: 4500, text: "📚 Reviewing what I know…" },
    { at: 7000, text: "✍️ Preparing the answer…" },
    { at: 10000, text: "✨ Polishing the response…" },
    { at: 14000, text: "🚀 Almost there…" },
  ],
  web: [
    { at: 0, text: "🔎 Understanding your question…" },
    { at: 2000, text: "🌐 Searching trusted sources…" },
    { at: 4500, text: "📰 Reading the best articles…" },
    { at: 7000, text: "⚖️ Comparing the information…" },
    { at: 10000, text: "✍️ Writing a clear answer…" },
    { at: 14000, text: "🚀 Almost there…" },
  ],
  media: [
    { at: 0, text: "📄 Reading your document…" },
    { at: 2000, text: "🔖 Finding the relevant pages…" },
    { at: 4500, text: "🎯 Retrieving the best sections…" },
    { at: 7000, text: "🧩 Connecting the details…" },
    { at: 10000, text: "✍️ Grounding the answer in your notes…" },
    { at: 14000, text: "🚀 Almost there…" },
  ],
  quiz: [
    { at: 0, text: "🧠 Understanding the topic…" },
    { at: 2000, text: "📝 Preparing the questions…" },
    { at: 4500, text: "⚖️ Balancing the difficulty…" },
    { at: 7000, text: "✅ Verifying the answers…" },
    { at: 10000, text: "🎯 Assembling your quiz…" },
    { at: 14000, text: "🚀 Almost there…" },
  ],
  flashcard: [
    { at: 0, text: "🧠 Extracting key concepts…" },
    { at: 2000, text: "🃏 Creating revision cards…" },
    { at: 4500, text: "📚 Organizing the study material…" },
    { at: 7000, text: "✨ Adding helpful examples…" },
    { at: 10000, text: "🎯 Finishing your deck…" },
    { at: 14000, text: "🚀 Almost there…" },
  ],
};
