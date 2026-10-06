// Branching questionnaire for the Exam Prep setup. The first answer (what
// kind of exam) decides which follow-up questions appear — class, board and
// stream for school and board exams; the exact exam, paper and attempt for
// entrance exams; degree and semester for college — so the backend can
// research the exact official syllabus instead of guessing. Pure config and
// helpers (no React), shared by the form and tested by TypeScript only.

// "competitive" stays in the type for backend compatibility (older plans),
// but the setup no longer offers it: full entrance-exam preparation (JEE,
// NEET, UPSC…) is far bigger than a day-by-day plan Aeva can cover honestly.
export type ExamKind =
  | "school"
  | "board"
  | "college"
  | "unit"
  | "competitive"
  | "other";

export interface KindOption {
  id: ExamKind;
  label: string;
  hint: string;
}

export const EXAM_KINDS: KindOption[] = [
  { id: "school", label: "School exam", hint: "Unit test, mid-term or final" },
  { id: "board", label: "Board exam", hint: "Class 10 / 12 boards or pre-boards" },
  { id: "college", label: "College / university", hint: "Semester or degree exams" },
  {
    id: "unit",
    label: "One subject or unit",
    hint: "A chapter test, a weak subject, a few units",
  },
  { id: "other", label: "Something else", hint: "Describe it in your own words" },
];

/** Where Aeva's plans stop today: full entrance / competitive preparation. */
export const UNSUPPORTED_EXAM_NOTE =
  "Aeva's exam plans currently cover school, board and college exams and single subjects or units. Full preparation for big entrance exams isn't available yet.";

const UNSUPPORTED_EXAMS: [RegExp, string][] = [
  [/\bjee\b|iit[- ]?jee|\biit\b/i, "JEE"],
  [/\bneet\b|\baiims\b/i, "NEET"],
  [/\bupsc\b|\bias\b|civil services|\bcse\b prelims|\bprelims\b/i, "UPSC"],
  [/\bssc\b|\bcgl\b|\bchsl\b/i, "SSC"],
  [/\bgate\b/i, "GATE"],
  [/\bcat\b|\bxat\b|\bnmat\b|\bsnap\b/i, "CAT"],
  [/\bcuet\b/i, "CUET"],
  [/\bnda\b|\bcds\b/i, "NDA"],
  [/\bclat\b|\bailet\b/i, "CLAT"],
  [/\bibps\b|\bsbi\b|\brrb\b|bank(ing)? exam|\bpo\b exam/i, "Banking"],
  [/\bnet\b|\bugc\b|\bcsir\b/i, "UGC NET"],
  [/\bgre\b|\bgmat\b|\bsat\b|\bielts\b|\btoefl\b/i, "GRE / GMAT / IELTS"],
];

/** The big exam a free-text name refers to, or null when it is fine. */
export function unsupportedExamName(name: string): string | null {
  const text = name.trim();
  if (!text) return null;
  for (const [re, label] of UNSUPPORTED_EXAMS) if (re.test(text)) return label;
  return null;
}

/* ---------------------------------- unit --------------------------------- */

export const UNIT_LEVELS = ["Class 6–8", "Class 9–10", "Class 11–12", "College"];
export const UNIT_SUBJECTS = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Science",
  "Social Science",
  "Economics",
  "Accountancy",
  "Computer Science",
];

/* --------------------------------- school -------------------------------- */

export const SCHOOL_CLASSES = ["6", "7", "8", "9", "10", "11", "12"];
/** Classes where the stream matters (and boards are the big exam). */
export const SENIOR_CLASSES = new Set(["11", "12"]);
export const BOARD_CLASSES = ["10", "12"];

export const BOARDS = ["CBSE", "ICSE / ISC", "State Board", "IB", "Cambridge (IGCSE)"];
export const INDIAN_STATES = [
  "Maharashtra",
  "Uttar Pradesh",
  "Tamil Nadu",
  "Karnataka",
  "Andhra Pradesh",
  "Telangana",
  "Kerala",
  "Gujarat",
  "Rajasthan",
  "Madhya Pradesh",
  "West Bengal",
  "Bihar",
  "Punjab",
  "Haryana",
  "Odisha",
  "Delhi",
];

export const STREAMS = ["Science (PCM)", "Science (PCB)", "Science (PCMB)", "Commerce", "Arts / Humanities"];

export const SCHOOL_EXAM_TYPES = [
  "Unit test",
  "Mid-term / half-yearly",
  "Final exam",
  "Pre-board",
];
export const BOARD_EXAM_TYPES = ["Board exam", "Pre-board", "Improvement / compartment"];
export const MEDIUMS = ["English", "Hindi", "Regional language"];

/* --------------------------------- college ------------------------------- */

export const DEGREES = ["B.Tech / B.E.", "B.Sc", "B.Com", "BA", "BBA", "BCA", "MBBS", "MBA", "M.Tech", "M.Sc"];
export const SEMESTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];
export const COLLEGE_EXAM_TYPES = ["Mid-semester", "End-semester", "Supplementary / backlog"];

/* -------------------------------- subjects ------------------------------- */

const JUNIOR_SCHOOL = ["Mathematics", "Science", "Social Science", "English", "Hindi"];
const STREAM_SUBJECTS: Record<string, string[]> = {
  "Science (PCM)": ["Physics", "Chemistry", "Mathematics", "English"],
  "Science (PCB)": ["Physics", "Chemistry", "Biology", "English"],
  "Science (PCMB)": ["Physics", "Chemistry", "Mathematics", "Biology", "English"],
  Commerce: ["Accountancy", "Business Studies", "Economics", "Mathematics", "English"],
  "Arts / Humanities": ["History", "Political Science", "Geography", "Economics", "English"],
};

export interface SetupAnswers {
  kind: ExamKind | null;
  /** School / board */
  schoolClass: string;
  board: string;
  state: string;
  stream: string;
  schoolExamType: string;
  medium: string;
  /** One subject or unit */
  unitLevel: string;
  unitSubject: string;
  unitChapters: string;
  /** College */
  degree: string;
  semester: string;
  collegeExamType: string;
  university: string;
  /** Other / overrides */
  customExamName: string;
  details: string;
}

export const EMPTY_ANSWERS: SetupAnswers = {
  kind: null,
  schoolClass: "",
  board: "",
  state: "",
  stream: "",
  schoolExamType: "",
  medium: "",
  unitLevel: "",
  unitSubject: "",
  unitChapters: "",
  degree: "",
  semester: "",
  collegeExamType: "",
  university: "",
  customExamName: "",
  details: "",
};

/** Suggested subjects for the answers so far (the student edits them). */
export function suggestedSubjectsFor(a: SetupAnswers): string[] {
  switch (a.kind) {
    case "school":
    case "board": {
      if (SENIOR_CLASSES.has(a.schoolClass)) {
        return STREAM_SUBJECTS[a.stream] ?? ["Physics", "Chemistry", "Mathematics", "Biology", "English"];
      }
      return a.schoolClass ? JUNIOR_SCHOOL : [];
    }
    case "unit":
      return a.unitSubject.trim() ? [a.unitSubject.trim()] : [];
    default:
      return [];
  }
}

/** The board as the backend / research prompt should see it. */
export function boardFor(a: SetupAnswers): string {
  if (a.kind === "school" || a.kind === "board") {
    if (a.board === "State Board") return a.state ? `${a.state} State Board` : "State Board";
    return a.board;
  }
  if (a.kind === "college") return a.university.trim();
  return "";
}

/** The class / level as the backend expects it (free text, ≤60). */
export function classLevelFor(a: SetupAnswers): string {
  if (a.kind === "school" || a.kind === "board") return a.schoolClass ? `Class ${a.schoolClass}` : "";
  if (a.kind === "unit") return a.unitLevel;
  if (a.kind === "college") {
    const parts = [a.degree, a.semester ? `Semester ${a.semester}` : ""].filter(Boolean);
    return parts.join(", ");
  }
  return "";
}

export function streamFor(a: SetupAnswers): string {
  if ((a.kind === "school" || a.kind === "board") && SENIOR_CLASSES.has(a.schoolClass)) return a.stream;
  return "";
}

/** A readable exam name composed from the answers (the student can edit). */
export function composeExamName(a: SetupAnswers): string {
  switch (a.kind) {
    case "school": {
      const cls = a.schoolClass ? `Class ${a.schoolClass}` : "";
      const type = a.schoolExamType || "school exam";
      return [cls, a.board && a.board !== "State Board" ? a.board : "", type]
        .filter(Boolean)
        .join(" ");
    }
    case "board": {
      const cls = a.schoolClass ? `Class ${a.schoolClass}` : "";
      const board = a.board === "State Board" ? (a.state ? `${a.state} Board` : "State Board") : a.board;
      const type = a.schoolExamType && a.schoolExamType !== "Board exam" ? a.schoolExamType : "Board exam";
      return [cls, board, type].filter(Boolean).join(" ");
    }
    case "unit": {
      const subject = a.unitSubject.trim();
      if (!subject) return "";
      const chapters = a.unitChapters.trim();
      return chapters ? `${subject} test · ${chapters}` : `${subject} unit test`;
    }
    case "college": {
      return [a.degree, a.semester ? `Semester ${a.semester}` : "", a.collegeExamType || "exam"]
        .filter(Boolean)
        .join(" ");
    }
    default:
      return "";
  }
}

/** Everything specific the student told us, for the research prompt. */
export function detailsFor(a: SetupAnswers): string {
  const bits: string[] = [];
  if (a.kind === "school" || a.kind === "board") {
    if (a.medium) bits.push(`${a.medium} medium`);
    if (a.board === "State Board" && a.state) bits.push(`${a.state} state syllabus`);
    if (a.schoolExamType) bits.push(a.schoolExamType);
  }
  if (a.kind === "unit") {
    if (a.unitChapters.trim()) bits.push(`Only these chapters / units: ${a.unitChapters.trim()}`);
    if (a.unitLevel) bits.push(a.unitLevel);
  }
  if (a.kind === "college") {
    if (a.collegeExamType) bits.push(a.collegeExamType);
    if (a.university) bits.push(a.university);
  }
  if (a.details.trim()) bits.push(a.details.trim());
  return bits.join("; ").slice(0, 300);
}

/** Whether the branch has enough answers to continue. */
export function kindAnswersComplete(a: SetupAnswers): boolean {
  switch (a.kind) {
    case "school":
    case "board":
      return !!a.schoolClass && !!a.board && (!SENIOR_CLASSES.has(a.schoolClass) || !!a.stream);
    case "unit":
      return a.unitSubject.trim().length > 0;
    case "college":
      return !!a.degree;
    case "other":
      return a.customExamName.trim().length > 0;
    default:
      return false;
  }
}
