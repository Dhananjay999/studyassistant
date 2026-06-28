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
