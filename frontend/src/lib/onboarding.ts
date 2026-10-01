// Configuration-driven first-run onboarding.
//
// The flow is a decision tree: STEPS is an ordered list of question
// definitions, each declaring when it is shown (`showIf`), which options it
// offers (possibly depending on earlier answers), and its copy (possibly
// varying by learning context). The UI renders whatever the engine below
// returns, so adding a learner type, a question, or an option is a config
// change here — never a change to the onboarding component.

import type { LearningContext, LearningProfile, LearningProfileInput } from "@/types";

export interface Option {
  /** Stable id: drives branching and analytics. */
  id: string;
  /** Human label: shown in the UI and persisted on the profile. */
  label: string;
}

export const OTHER_ID = "other";
export const OTHER_LABEL = "Other";
/** Recommended cap on focus areas. */
export const FOCUS_MAX = 5;
/** Free-text caps (backend: 120 per text field, 40 per subject). */
export const CUSTOM_MAX = 60;
export const FOCUS_CUSTOM_MAX = 40;

const opts = (...labels: string[]): Option[] =>
  labels.map((label) => ({
    id: label
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
    label,
  }));

/* -------------------------------- options -------------------------------- */

export const CONTEXTS: Option[] = [
  { id: "school", label: "School" },
  { id: "college", label: "College / University" },
  { id: "competitive_exam", label: "Competitive Exam Preparation" },
  { id: "skill_learning", label: "Learning a Skill" },
  { id: "working_professional", label: "Working Professional" },
];

const SCHOOL_CLASSES = opts("Class 6–8", "Class 9–10", "Class 11–12");
const BOARDS = opts("CBSE", "ICSE", "State Board", "Not sure");
const DEGREES: Option[] = [
  { id: "btech", label: "B.Tech / B.E." },
  { id: "bsc", label: "B.Sc" },
  { id: "bca", label: "BCA" },
  { id: "bba", label: "BBA" },
  { id: "mba", label: "MBA" },
  { id: "mtech", label: "M.Tech" },
];
const YEARS = opts("1st Year", "2nd Year", "3rd Year", "4th Year");
const EXAMS = opts("JEE", "NEET", "UPSC", "SSC", "Banking", "GATE", "CAT");
const SKILLS = opts(
  "Programming",
  "Web Development",
  "Data Science",
  "AI & ML",
  "Design",
  "Finance",
  "Languages",
);

const GOALS = {
  school: opts(
    "Understand concepts",
    "Prepare for exams",
    "Practice questions",
    "Revise topics",
    "Prepare for competitive exams",
    "Explore a subject",
  ),
  college: opts(
    "Understand concepts",
    "Prepare for semester exams",
    "Complete assignments",
    "Prepare for placements",
    "Learn practical skills",
    "Prepare for interviews",
  ),
  competitive_exam: opts(
    "Full preparation",
    "Revision",
    "Practice",
    "Mock tests",
    "Doubt solving",
  ),
  skill_learning: opts(
    "Learn from scratch",
    "Build projects",
    "Improve existing skills",
    "Prepare for interviews",
    "Get certified",
  ),
  working_professional: opts(
    "Learn a new skill",
    "Improve existing skills",
    "Prepare for interviews",
    "Solve work-related doubts",
    "Career development",
    "Explore a topic",
  ),
};
const GENERIC_GOALS = opts(
  "Understand concepts",
  "Prepare for exams",
  "Practice questions",
  "Learn a new skill",
  "Explore a topic",
);

const SCHOOL_SUBJECTS = opts(
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Economics",
  "History",
  "Geography",
  "Computer Science",
);
const CS_TOPICS = opts(
  "Data Structures",
  "Algorithms",
  "DBMS",
  "Operating Systems",
  "Computer Networks",
  "Java",
  "Python",
  "Web Development",
  "AI & ML",
  "System Design",
);
const SCIENCE_TOPICS = opts(
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "Statistics",
  "Computer Science",
);
const BUSINESS_TOPICS = opts(
  "Accounting",
  "Finance",
  "Marketing",
  "Economics",
  "Business Statistics",
  "Organizational Behaviour",
  "Operations",
);
const COLLEGE_TOPICS = opts(
  "Mathematics",
  "Programming",
  "Economics",
  "Statistics",
  "Communication Skills",
  "Research Methods",
);
const EXAM_TOPICS: Record<string, Option[]> = {
  jee: opts("Physics", "Chemistry", "Mathematics"),
  neet: opts("Physics", "Chemistry", "Biology"),
  upsc: opts(
    "Polity",
    "History",
    "Geography",
    "Economy",
    "Environment",
    "Science & Tech",
    "Current Affairs",
    "Ethics",
  ),
  ssc: opts("Quantitative Aptitude", "Reasoning", "English", "General Awareness"),
  banking: opts(
    "Quantitative Aptitude",
    "Reasoning",
    "English",
    "General Awareness",
    "Computer Knowledge",
  ),
  gate: opts(
    "Engineering Mathematics",
    "General Aptitude",
    "Data Structures",
    "Algorithms",
    "Operating Systems",
    "DBMS",
    "Computer Networks",
  ),
  cat: opts("Quantitative Aptitude", "Verbal Ability", "Reading Comprehension", "DILR"),
};
const APTITUDE_TOPICS = opts(
  "Quantitative Aptitude",
  "Reasoning",
  "English",
  "General Awareness",
  "Current Affairs",
);
const SKILL_TOPICS: Record<string, Option[]> = {
  programming: opts("Python", "Java", "JavaScript", "C++", "Data Structures", "Algorithms"),
  web_development: opts("HTML & CSS", "JavaScript", "React", "Node.js", "Databases", "APIs"),
  data_science: opts("Python", "Statistics", "SQL", "Pandas", "Data Visualization", "Machine Learning"),
  ai_and_ml: opts("Machine Learning", "Deep Learning", "NLP", "Computer Vision", "Generative AI", "Mathematics for ML"),
  design: opts("UI Design", "UX Research", "Figma", "Graphic Design", "Typography"),
  finance: opts("Personal Finance", "Investing", "Accounting", "Financial Modelling", "Stock Market"),
  languages: opts("English", "Spoken English", "Grammar", "Vocabulary", "Writing"),
};
const PROFESSIONAL_TOPICS = opts(
  "Programming",
  "Data Analysis",
  "AI & ML",
  "System Design",
  "Communication",
  "Leadership",
  "Excel",
  "Finance",
);
const GENERIC_TOPICS = opts(
  "Mathematics",
  "Science",
  "Programming",
  "English",
  "Economics",
  "General Knowledge",
);

/** Shared with the Settings form so both offer the same choices. */
export const STYLES = opts("Short & Quick", "Detailed", "Step-by-Step", "Example-Based");
export const LANGUAGES = opts("English", "Hindi", "Hinglish");
export const LANGUAGE_EXAMPLES = "e.g. Tamil, Telugu, Marathi, Bengali";
export const LANGUAGE_NOTE =
  "Note: This only controls the language Aeva uses in her responses. It does not change the app's interface language.";

/* -------------------------------- steps --------------------------------- */

export type SingleField =
  | "context"
  | "schoolClass"
  | "board"
  | "degree"
  | "year"
  | "exam"
  | "skill"
  | "goal"
  | "style"
  | "language";
export type StepId = SingleField | "focus";

export interface Copy {
  emoji: string;
  title: string;
  hint?: string;
}

/** Options picked by the first rule whose `by` answer has a mapping. */
interface OptionRules {
  rules: { by: SingleField; map: Record<string, Option[]> }[];
  fallback: Option[];
}

interface BaseStep {
  /** Short name for the edit overview ("Class", "Focus areas", …). */
  label: string;
  copy: Copy;
  /** Copy override per learning context ("none" = root skipped / Other). */
  copyByContext?: Record<string, Copy>;
  options: Option[] | OptionRules;
  /** Shown only when each listed answer is one of the given option ids. */
  showIf?: Partial<Record<SingleField, string[]>>;
  /** Small print under the options (e.g. the language disclaimer). */
  footnote?: string;
}

export interface SingleStep extends BaseStep {
  id: SingleField;
  kind: "single";
  /** Next stays disabled until answered (Skip is still available). */
  required?: boolean;
  /** Appends "Other", which requires a custom value. */
  other?: { placeholder: string; examples?: string };
}

export interface MultiStep extends BaseStep {
  id: "focus";
  kind: "multi";
  max: number;
  addOwnPlaceholder: string;
}

export type StepDef = SingleStep | MultiStep;

const GENERIC_GOAL_COPY: Copy = {
  emoji: "🎯",
  title: "What would you like Aeva to help you with?",
};

export const STEPS: StepDef[] = [
  {
    id: "context",
    kind: "single",
    label: "Learning context",
    required: true,
    copy: {
      emoji: "🎓",
      title: "Where are you in your learning journey?",
      hint: "This helps Aeva understand your learning context and personalize her responses.",
    },
    options: CONTEXTS,
    other: { placeholder: "Tell us where you are in your learning…" },
  },
  {
    id: "schoolClass",
    kind: "single",
    label: "Class",
    showIf: { context: ["school"] },
    copy: { emoji: "🏫", title: "Got it — which class are you in?" },
    options: SCHOOL_CLASSES,
    other: { placeholder: "Tell us your class" },
  },
  {
    id: "board",
    kind: "single",
    label: "Board",
    showIf: { context: ["school"] },
    copy: {
      emoji: "📘",
      title: "Which board are you studying under?",
      hint: "Helps Aeva stick to your syllabus.",
    },
    options: BOARDS,
    other: { placeholder: "Tell us your board" },
  },
  {
    id: "degree",
    kind: "single",
    label: "Program",
    showIf: { context: ["college"] },
    copy: { emoji: "🎓", title: "Nice — what are you studying?" },
    options: DEGREES,
    other: { placeholder: "Tell us what you're studying" },
  },
  {
    id: "year",
    kind: "single",
    label: "Year",
    showIf: { context: ["college"] },
    copy: { emoji: "📅", title: "Which year are you in?" },
    options: YEARS,
    other: { placeholder: "Tell us your year" },
  },
  {
    id: "exam",
    kind: "single",
    label: "Exam",
    showIf: { context: ["competitive_exam"] },
    copy: { emoji: "🏁", title: "Which exam are you preparing for?" },
    options: EXAMS,
    other: { placeholder: "Tell us your exam" },
  },
  {
    id: "skill",
    kind: "single",
    label: "Skill",
    showIf: { context: ["skill_learning"] },
    copy: { emoji: "🛠️", title: "What are you learning?" },
    options: SKILLS,
    other: { placeholder: "Type a skill or topic…" },
  },
  {
    id: "goal",
    kind: "single",
    label: "Goal",
    copy: { emoji: "🎯", title: "What are you mainly using Aeva for?" },
    copyByContext: {
      competitive_exam: {
        emoji: "🎯",
        title: "What are you mainly focusing on right now?",
      },
      working_professional: GENERIC_GOAL_COPY,
      other: GENERIC_GOAL_COPY,
      none: GENERIC_GOAL_COPY,
    },
    options: { rules: [{ by: "context", map: GOALS }], fallback: GENERIC_GOALS },
    other: { placeholder: "Tell us what you're trying to achieve" },
  },
  {
    id: "focus",
    kind: "multi",
    label: "Focus areas",
    max: FOCUS_MAX,
    copy: {
      emoji: "📚",
      title: "What should Aeva focus on?",
      hint: "Pick the subjects or topics you want Aeva to help you with.",
    },
    options: {
      // Order matters: the most specific answer wins.
      rules: [
        { by: "exam", map: EXAM_TOPICS },
        { by: "skill", map: SKILL_TOPICS },
        {
          by: "degree",
          map: {
            btech: CS_TOPICS,
            bca: CS_TOPICS,
            mtech: CS_TOPICS,
            bsc: SCIENCE_TOPICS,
            bba: BUSINESS_TOPICS,
            mba: BUSINESS_TOPICS,
          },
        },
        {
          by: "context",
          map: {
            school: SCHOOL_SUBJECTS,
            college: COLLEGE_TOPICS,
            competitive_exam: APTITUDE_TOPICS,
            working_professional: PROFESSIONAL_TOPICS,
          },
        },
      ],
      fallback: GENERIC_TOPICS,
    },
    addOwnPlaceholder: "Add a subject or topic",
  },
  {
    id: "style",
    kind: "single",
    label: "Explanation style",
    copy: {
      emoji: "🧠",
      title: "How should Aeva explain things?",
      hint: "Choose the explanation style that works best for you.",
    },
    options: STYLES,
  },
  {
    id: "language",
    kind: "single",
    label: "Response language",
    copy: {
      emoji: "🌎",
      title: "And finally — what language should Aeva use?",
      hint: "Choose the language you'd like Aeva to use in her responses.",
    },
    options: LANGUAGES,
    other: {
      placeholder: "Type your preferred language…",
      examples: LANGUAGE_EXAMPLES,
    },
    footnote: LANGUAGE_NOTE,
  },
];

/* -------------------------------- engine -------------------------------- */

export interface Answers {
  /** Option id per single-select question ("other" for a custom value). */
  single: Partial<Record<SingleField, string>>;
  /** Free text for questions answered with "Other". */
  custom: Partial<Record<SingleField, string>>;
  /** Focus areas as labels (curated or user-added). */
  focus: string[];
}

export const EMPTY_ANSWERS: Answers = { single: {}, custom: {}, focus: [] };

export const stepById = (id: StepId): StepDef =>
  STEPS.find((s) => s.id === id) ?? STEPS[0];

/** Analytics branch name: the context id, or "none" when skipped. */
export const branchOf = (a: Answers): string => a.single.context ?? "none";

export function isVisible(step: StepDef, a: Answers): boolean {
  if (!step.showIf) return true;
  return Object.entries(step.showIf).every(([field, ids]) => {
    const value = a.single[field as SingleField];
    return !!value && ids.includes(value);
  });
}

export const visibleSteps = (a: Answers): StepDef[] =>
  STEPS.filter((s) => isVisible(s, a));

export function optionsFor(step: StepDef, a: Answers): Option[] {
  if (Array.isArray(step.options)) return step.options;
  for (const rule of step.options.rules) {
    const value = a.single[rule.by];
    if (value && rule.map[value]) return rule.map[value];
  }
  return step.options.fallback;
}

export function copyFor(step: StepDef, a: Answers): Copy {
  return step.copyByContext?.[branchOf(a)] ?? step.copy;
}

/** True when the step has no answer (what "Skip"/empty Next means). */
export function isUnanswered(step: StepDef, a: Answers): boolean {
  return step.kind === "multi" ? a.focus.length === 0 : !a.single[step.id];
}

/** Contextual validation: "Other" needs its custom value; required needs an answer. */
export function canContinue(step: StepDef, a: Answers): boolean {
  if (step.kind === "multi") return true;
  const value = a.single[step.id];
  if (step.required && !value) return false;
  if (value === OTHER_ID) return !!a.custom[step.id]?.trim();
  return true;
}

/** Resolved label of a single answer (custom text for "Other"). */
export function labelOf(id: SingleField, a: Answers): string {
  const value = a.single[id];
  if (!value) return "";
  if (value === OTHER_ID) return a.custom[id]?.trim() ?? "";
  const step = stepById(id);
  return optionsFor(step, a).find((o) => o.id === value)?.label ?? "";
}

function clear(a: Answers, step: StepDef): void {
  if (step.kind === "multi") {
    a.focus = [];
  } else {
    delete a.single[step.id];
    delete a.custom[step.id];
  }
}

/**
 * Apply one answer change and keep dependent answers consistent:
 * answers to questions that are no longer shown are dropped (School →
 * College clears class/board), and when a question's option set changes
 * (JEE → NEET) only answers still offered survive (Physics, Chemistry stay;
 * Mathematics and custom values go). Going Back never calls this, so it
 * never loses answers.
 */
function reconcile(prev: Answers, next: Answers, changed: StepId): Answers {
  for (const step of STEPS) {
    if (step.id === changed) continue;
    if (!isVisible(step, next)) {
      clear(next, step);
      continue;
    }
    const before = optionsFor(step, prev);
    const after = optionsFor(step, next);
    if (before === after) continue;
    if (step.kind === "multi") {
      const labels = new Set(after.map((o) => o.label));
      next.focus = next.focus.filter((f) => labels.has(f));
    } else {
      const value = next.single[step.id];
      if (value && !after.some((o) => o.id === value)) clear(next, step);
    }
  }
  return next;
}

export function setSingle(a: Answers, id: SingleField, value: string): Answers {
  const next: Answers = {
    single: { ...a.single },
    custom: { ...a.custom },
    focus: [...a.focus],
  };
  if (value) next.single[id] = value;
  else delete next.single[id];
  if (value !== OTHER_ID) delete next.custom[id];
  return reconcile(a, next, id);
}

export function setCustom(a: Answers, id: SingleField, text: string): Answers {
  return { ...a, custom: { ...a.custom, [id]: text } };
}

export function toggleFocus(a: Answers, label: string): Answers {
  const focus = a.focus.includes(label)
    ? a.focus.filter((f) => f !== label)
    : a.focus.length < FOCUS_MAX
      ? [...a.focus, label]
      : a.focus;
  return { ...a, focus };
}

/** First run: carry over only the cross-branch preferences already saved
 * (e.g. a "talk in Hinglish" chat request), never stale branch answers. */
export function carryOverPreferences(
  profile: LearningProfile | null | undefined,
): Answers {
  const a: Answers = { single: {}, custom: {}, focus: [] };
  if (!profile) return a;
  matchInto(a, "style", profile.explanation_style);
  matchInto(a, "language", profile.response_language);
  return a;
}

/** Set a single answer from a saved label: its option id, else "Other"
 * with the label as custom text (when the question allows Other). */
function matchInto(a: Answers, id: SingleField, label: string | null | undefined): void {
  const value = label?.trim();
  if (!value) return;
  const step = stepById(id);
  const known = optionsFor(step, a).find(
    (o) => o.label.toLowerCase() === value.toLowerCase(),
  );
  if (known) {
    a.single[id] = known.id;
  } else if (step.kind === "single" && step.other) {
    a.single[id] = OTHER_ID;
    a.custom[id] = value;
  }
}

/**
 * Edit mode: rebuild every answer from a saved profile (existing users were
 * converted to the same document by migration 025, so there is one shape).
 * Values no list offers come back as "Other" with their text.
 */
export function fromProfile(profile: LearningProfile | null | undefined): Answers {
  const a = carryOverPreferences(profile);
  if (!profile) return a;
  const ctx = profile.context ?? {};
  if (ctx.type) {
    const known = CONTEXTS.some((o) => o.id === ctx.type);
    a.single.context = known ? ctx.type : OTHER_ID;
    if (!known) a.custom.context = ctx.other || ctx.type;
    matchInto(a, "schoolClass", ctx.class);
    matchInto(a, "board", ctx.board);
    matchInto(a, "degree", ctx.degree);
    matchInto(a, "year", ctx.year);
    matchInto(a, "exam", ctx.exam);
    matchInto(a, "skill", ctx.skill);
  }
  matchInto(a, "goal", profile.goal);
  a.focus = [...(profile.focus_areas ?? [])];
  return a;
}

/** Display text of a step's answer ("" when unanswered). */
export function answerText(step: StepDef, a: Answers): string {
  return step.kind === "multi" ? a.focus.join(", ") : labelOf(step.id, a);
}

const CONTEXT_LABELS: Record<string, string> = Object.fromEntries(
  CONTEXTS.map((o) => [o.id, o.label]),
);

/** One-line, human-readable description of a saved learning context. */
export function describeContext(ctx: LearningContext | null | undefined): string {
  if (!ctx) return "";
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(", ");
  const detailed = (label: string, detail: string) =>
    detail ? `${label} — ${detail}` : label;
  switch (ctx.type) {
    case "school":
      return detailed(
        CONTEXT_LABELS.school,
        join(ctx.class, ctx.board === "Not sure" ? undefined : ctx.board),
      );
    case "college":
      return detailed(CONTEXT_LABELS.college, join(ctx.degree, ctx.year));
    case "competitive_exam":
      return ctx.exam ? `Preparing for ${ctx.exam}` : CONTEXT_LABELS.competitive_exam;
    case "skill_learning":
      return ctx.skill ? `Learning ${ctx.skill}` : CONTEXT_LABELS.skill_learning;
    case "working_professional":
      return CONTEXT_LABELS.working_professional;
    default:
      return ctx.other || ctx.type || "";
  }
}

/** The learning context to store: answers of the questions on the branch. */
export function toLearningContext(a: Answers): LearningContext {
  const ctx: LearningContext = {};
  const type = a.single.context;
  if (!type) return ctx;
  ctx.type = type;
  const put = (key: keyof LearningContext, id: SingleField) => {
    const label = labelOf(id, a);
    if (label && isVisible(stepById(id), a)) ctx[key] = label;
  };
  if (type === OTHER_ID) put("other", "context");
  put("class", "schoolClass");
  put("board", "board");
  put("degree", "degree");
  put("year", "year");
  put("exam", "exam");
  put("skill", "skill");
  return ctx;
}

/**
 * Full save payload. The endpoint writes the whole document, so values this
 * flow does not ask about (persona, instructions, traits) pass through.
 */
export function toProfileInput(
  a: Answers,
  profile: LearningProfile | null | undefined,
): LearningProfileInput {
  return {
    context: toLearningContext(a),
    goal: labelOf("goal", a) || null,
    focus_areas: a.focus,
    explanation_style: labelOf("style", a) || null,
    response_language: labelOf("language", a) || null,
    ai_personality: profile?.ai_personality ?? null,
    communication_style: profile?.communication_style ?? null,
    custom_instructions: profile?.custom_instructions ?? null,
    learning_traits: profile?.learning_traits ?? {},
  };
}

const STYLE_PHRASES: Record<string, string> = {
  short_and_quick: "keep explanations short & quick",
  detailed: "explain things in detail",
  step_by_step: "explain things step-by-step",
  example_based: "explain things with examples",
};

/** Celebration copy that plays back what Aeva learned, or null if nothing. */
export function personalizationSummary(a: Answers): string | null {
  const style = a.single.style ? STYLE_PHRASES[a.single.style] : "";
  const language = labelOf("language", a);
  const focus = a.focus.slice(0, 3).join(", ");
  if (!style && !language && !focus) return null;
  let text = `Got it — Aeva will ${style || "tailor her answers"}`;
  if (language) text += ` in ${language}`;
  if (focus) text += `, focusing on ${focus}`;
  return `${text}.`;
}
