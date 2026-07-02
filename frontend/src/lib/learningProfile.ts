// Curated choices for the personalization onboarding + settings.
// Lists are intentionally editable here so new options can be added later
// without touching the wizard or settings UI. Free-text "Other" is supported
// for the learning level, which is the highest-signal field.

export const EDUCATION_LEVELS = [
  "School (Class 6–8)",
  "Class 9–10",
  "Class 11–12",
  "Diploma",
  "B.Tech",
  "B.Sc",
  "M.Tech",
  "MBA",
  "UPSC",
  "SSC",
  "JEE",
  "NEET",
  "Working Professional",
] as const;

export const PREFERRED_LANGUAGES = ["English", "Hindi", "Hinglish"] as const;

export const EXPLANATION_STYLES = [
  "Short & Quick",
  "Detailed",
  "Step-by-Step",
  "Example-Based",
] as const;

export const FAVORITE_SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Computer Science",
  "Java",
  "Web Development",
  "Data Structures",
  "AI & ML",
  "History",
  "Geography",
  "Economics",
] as const;

export const LEARNING_GOALS = [
  "School Exams",
  "College",
  "Placements",
  "Competitive Exams",
  "Job Interview",
  "Skill Learning",
  "Personal Interest",
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
