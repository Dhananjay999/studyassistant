// Curated choices for the Settings-only personalization fields (persona,
// communication style, teaching extras). The learner questions shared by
// onboarding and Settings — context, goal, focus areas, explanation style,
// response language — live in `lib/onboarding.ts`.

/** Boolean learning traits shown as toggle chips (key ↔ label). */
export const LEARNING_TRAIT_OPTIONS = [
  { key: "likes_funny_examples", label: "Funny examples" },
  { key: "likes_visual_explanations", label: "Visual explanations" },
  { key: "wants_concept_check_questions", label: "Concept-check questions" },
] as const;

export const PREFERRED_DEPTHS = [
  "Simple",
  "Conceptual",
  "Exam-level",
  "Deep",
] as const;

/**
 * How Aeva should interact — the persona/teaching stance. The emoji + blurb
 * are shown in the settings picker; the bare label is what gets persisted and
 * sent to the model.
 */
export const AI_PERSONALITIES = [
  { value: "Teacher", emoji: "👨‍🏫", blurb: "Structured, academic, explanatory." },
  { value: "Mentor", emoji: "🧑‍🏫", blurb: "Guides with advice and encouragement." },
  { value: "Study Buddy", emoji: "🤝", blurb: "Friendly and collaborative." },
  { value: "Interview Coach", emoji: "💼", blurb: "Focuses on interview prep." },
  { value: "Exam Coach", emoji: "🎯", blurb: "Exam-oriented, revision-first." },
  { value: "Technical Expert", emoji: "💻", blurb: "In-depth, technical, precise." },
] as const;

/** Preferred answer shape / communication style. */
export const COMMUNICATION_STYLES = [
  "Short & Direct",
  "Step-by-Step",
  "Example-Based",
  "Detailed",
] as const;

/** Example prompts shown under the custom-instructions field. */
export const CUSTOM_INSTRUCTION_EXAMPLES = [
  "Always explain with real-life examples.",
  "Correct my mistakes before answering.",
  "Assume I'm a beginner unless I say otherwise.",
  "Keep answers concise.",
] as const;
