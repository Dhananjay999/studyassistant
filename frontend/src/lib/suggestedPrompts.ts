// Personalized "new chat" prompt suggestions.
//
// Instead of a tiny hardcoded list, we keep a broad bank of templates keyed by
// the user's learning-profile signals (favorite subjects, education level,
// learning goal, preferred language). `buildSuggestedPrompts` filters the bank
// to the profile, de-duplicates, shuffles, and returns a fresh combination each
// time — so two users (and two visits) rarely see the same set.
//
// Every prompt is written to be COMPLETE and self-contained: it names a
// concrete topic and the desired output, so clicking one almost never triggers
// a clarification round-trip. We avoid bare demonstratives ("this", "that")
// because the orchestrator asks for clarification when it can't resolve them.

import {
  BookOpen,
  Calculator,
  FileText,
  Lightbulb,
  ListChecks,
  PenLine,
  Repeat,
  type LucideIcon,
} from "lucide-react";
import type { LearningProfile } from "@/types";

export interface SuggestedPrompt {
  text: string;
  icon: LucideIcon;
}

// Shown when the user hasn't completed onboarding. Concrete, fully-specified
// prompts that produce a great answer on the first click.
const GENERIC: SuggestedPrompt[] = [
  {
    text: "Explain Artificial Intelligence with real-world examples for beginners",
    icon: BookOpen,
  },
  {
    text: "Create a 15-question MCQ quiz on Newton's Laws of Motion with explanations",
    icon: ListChecks,
  },
  {
    text: "Compare Machine Learning and Deep Learning with practical examples",
    icon: Lightbulb,
  },
  {
    text: "Explain DBMS normalization (1NF to BCNF) with examples and interview questions",
    icon: BookOpen,
  },
  {
    text: "Summarize the key concepts of photosynthesis for quick revision",
    icon: FileText,
  },
  {
    text: "Give me 10 trigonometry practice questions with step-by-step solutions",
    icon: PenLine,
  },
  {
    text: "Explain the difference between HTTP and HTTPS in simple terms",
    icon: BookOpen,
  },
  {
    text: "Teach me a fascinating science fact and explain why it happens",
    icon: Lightbulb,
  },
];

function subjectPrompts(subjects: string[]): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = [];
  for (const s of subjects.slice(0, 4)) {
    out.push(
      {
        text: `Explain the core concepts of ${s} with real-world examples`,
        icon: BookOpen,
      },
      {
        text: `Create a 15-question MCQ quiz on ${s} with explanations`,
        icon: ListChecks,
      },
      {
        text: `Give me the most important ${s} interview questions with answers`,
        icon: PenLine,
      },
      {
        text: `Summarize the key ${s} topics I should revise before an exam`,
        icon: FileText,
      },
      {
        text: `Explain a difficult ${s} concept step by step with examples`,
        icon: Repeat,
      },
    );
  }
  return out;
}

interface Group {
  match: string[];
  prompts: SuggestedPrompt[];
}

// Matched by case-insensitive substring against the (possibly free-text) level.
const LEVEL_GROUPS: Group[] = [
  {
    match: ["b.tech", "btech", "engineering", "diploma", "m.tech", "mtech"],
    prompts: [
      {
        text: "Explain how an Operating System manages processes and memory",
        icon: BookOpen,
      },
      {
        text: "Create a 15-question DBMS quiz with explanations",
        icon: ListChecks,
      },
      {
        text: "Explain Computer Networks: compare the OSI and TCP/IP models",
        icon: BookOpen,
      },
      {
        text: "Give me common Data Structures & Algorithms interview questions with solutions",
        icon: PenLine,
      },
      {
        text: "Explain OOP concepts (encapsulation, inheritance, polymorphism) with examples",
        icon: BookOpen,
      },
    ],
  },
  {
    match: ["upsc", "ias"],
    prompts: [
      {
        text: "Explain the key features of the Indian Constitution with examples",
        icon: BookOpen,
      },
      {
        text: "Create a 10-question quiz on Indian Polity with explanations",
        icon: ListChecks,
      },
      {
        text: "Summarize the fundamentals of the Indian Economy for revision",
        icon: FileText,
      },
      {
        text: "Explain the causes and effects of the Revolt of 1857",
        icon: Repeat,
      },
    ],
  },
  {
    match: ["neet"],
    prompts: [
      {
        text: "Explain the structure and working of the human heart with a diagram description",
        icon: BookOpen,
      },
      {
        text: "Create a 20-question Biology quiz on the human digestive system with explanations",
        icon: ListChecks,
      },
      {
        text: "Explain the key reactions of organic chemistry (GOC) with examples",
        icon: Repeat,
      },
      {
        text: "Give me 10 NEET Physics practice questions on optics with solutions",
        icon: PenLine,
      },
    ],
  },
  {
    match: ["jee"],
    prompts: [
      {
        text: "Solve a tough JEE Physics problem on rotational motion step by step",
        icon: Calculator,
      },
      {
        text: "Create a 15-question JEE Maths quiz on calculus with solutions",
        icon: ListChecks,
      },
      {
        text: "Explain rotational motion and torque with worked examples",
        icon: BookOpen,
      },
      {
        text: "Give me 10 coordinate geometry practice questions with step-by-step answers",
        icon: PenLine,
      },
    ],
  },
  {
    match: ["11", "12", "intermediate", "+2"],
    prompts: [
      {
        text: "Explain integration step by step with 3 solved examples",
        icon: Calculator,
      },
      {
        text: "Create a 15-question Physics quiz on electrostatics with explanations",
        icon: ListChecks,
      },
      {
        text: "Explain how to balance chemical equations with examples",
        icon: PenLine,
      },
      {
        text: "Summarize the key formulas from calculus for quick revision",
        icon: FileText,
      },
    ],
  },
  {
    match: ["6", "7", "8", "9", "10", "school"],
    prompts: [
      {
        text: "Explain Newton's three laws of motion with everyday examples",
        icon: BookOpen,
      },
      {
        text: "Create a 10-question Science quiz on the water cycle with explanations",
        icon: ListChecks,
      },
      {
        text: "Explain photosynthesis simply with a step-by-step breakdown",
        icon: Repeat,
      },
      {
        text: "Give me 10 practice questions on fractions with step-by-step solutions",
        icon: PenLine,
      },
    ],
  },
  {
    match: ["mba", "bba"],
    prompts: [
      {
        text: "Explain the marketing mix (4Ps) with a real company example",
        icon: BookOpen,
      },
      {
        text: "Create a 10-question Finance quiz on time value of money with explanations",
        icon: ListChecks,
      },
      {
        text: "Summarize key microeconomics concepts (demand, supply, elasticity)",
        icon: FileText,
      },
    ],
  },
  {
    match: ["ssc", "bank", "railway"],
    prompts: [
      {
        text: "Create a 15-question General Knowledge quiz on Indian geography with answers",
        icon: ListChecks,
      },
      {
        text: "Give me 10 quantitative aptitude questions on percentages with solutions",
        icon: PenLine,
      },
      {
        text: "Explain the basics of Indian polity for competitive exams",
        icon: BookOpen,
      },
    ],
  },
  {
    match: ["working", "professional"],
    prompts: [
      {
        text: "Explain the fundamentals of project management with examples",
        icon: BookOpen,
      },
      {
        text: "Create a 10-question quiz on communication skills with explanations",
        icon: ListChecks,
      },
      {
        text: "Summarize the key ideas of effective time management",
        icon: FileText,
      },
    ],
  },
];

const GOAL_GROUPS: Group[] = [
  {
    match: ["placement"],
    prompts: [
      {
        text: "Give me the top 15 DSA interview questions with solutions",
        icon: PenLine,
      },
      {
        text: "Explain system design basics with a URL shortener example",
        icon: BookOpen,
      },
      {
        text: "Create a 15-question aptitude quiz for placements with answers",
        icon: ListChecks,
      },
      {
        text: "Give me common HR interview questions with sample answers",
        icon: PenLine,
      },
    ],
  },
  {
    match: ["competitive"],
    prompts: [
      {
        text: "Create a 15-question current affairs quiz for this month with explanations",
        icon: ListChecks,
      },
      {
        text: "Summarize the most important static GK topics for competitive exams",
        icon: FileText,
      },
      {
        text: "Give me 10 reasoning practice questions with step-by-step solutions",
        icon: PenLine,
      },
    ],
  },
  {
    match: ["interview", "job"],
    prompts: [
      {
        text: "Give me the top 10 interview questions for my field with sample answers",
        icon: PenLine,
      },
      {
        text: "Explain how to answer behavioral interview questions using the STAR method",
        icon: BookOpen,
      },
      {
        text: "Create a 10-question quiz on core fundamentals with explanations",
        icon: ListChecks,
      },
    ],
  },
  {
    match: ["school exam", "college", "exam"],
    prompts: [
      {
        text: "Create a 15-question revision quiz on a topic of my choice with explanations",
        icon: ListChecks,
      },
      {
        text: "Explain a difficult chapter concept step by step with examples",
        icon: BookOpen,
      },
      {
        text: "Summarize the most important formulas and definitions for revision",
        icon: FileText,
      },
    ],
  },
  {
    match: ["skill"],
    prompts: [
      {
        text: "Give me a step-by-step 30-day learning roadmap for a new skill",
        icon: BookOpen,
      },
      {
        text: "Explain the fundamentals of a topic with beginner-friendly examples",
        icon: PenLine,
      },
      {
        text: "Create a 10-question quiz to test what I've learned with explanations",
        icon: ListChecks,
      },
    ],
  },
  {
    match: ["personal", "interest"],
    prompts: [
      {
        text: "Teach me a fascinating concept and explain why it matters",
        icon: Lightbulb,
      },
      {
        text: "Explain a complex idea simply using an everyday analogy",
        icon: BookOpen,
      },
    ],
  },
];

function collectGroups(value: string, groups: Group[]): SuggestedPrompt[] {
  const v = value.toLowerCase();
  const out: SuggestedPrompt[] = [];
  for (const g of groups) {
    if (g.match.some((m) => v.includes(m))) out.push(...g.prompts);
  }
  return out;
}

function dedupe(prompts: SuggestedPrompt[]): SuggestedPrompt[] {
  const seen = new Set<string>();
  return prompts.filter((p) => {
    const key = p.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build `count` suggested prompts tailored to the user's learning profile.
 * Falls back to a generic set when onboarding isn't completed.
 */
export function buildSuggestedPrompts(
  profile: LearningProfile | null | undefined,
  count = 6,
): SuggestedPrompt[] {
  if (!profile || profile.personalization_status !== "completed") {
    return shuffle(GENERIC).slice(0, count);
  }

  const pool: SuggestedPrompt[] = [];
  pool.push(...subjectPrompts(profile.favorite_subjects ?? []));
  if (profile.education_level) {
    pool.push(...collectGroups(profile.education_level, LEVEL_GROUPS));
  }
  if (profile.learning_goal) {
    pool.push(...collectGroups(profile.learning_goal, GOAL_GROUPS));
  }

  // Light language flavor: surface a localized variant so a Hindi/Hinglish
  // learner occasionally gets a fully-formed prompt in their language.
  const lang = profile.preferred_language;
  if (lang && lang !== "English") {
    const subject = (profile.favorite_subjects ?? [])[0];
    pool.push({
      text: subject
        ? `Explain the core concepts of ${subject} in ${lang} with examples`
        : `Explain a tough topic in ${lang} with simple examples`,
      icon: Lightbulb,
    });
  }

  const unique = dedupe(pool);
  // Backfill with generic prompts if the profile produced too few.
  if (unique.length < count) unique.push(...GENERIC);
  return shuffle(dedupe(unique)).slice(0, count);
}
