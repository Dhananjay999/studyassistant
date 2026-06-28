// Personalized "new chat" prompt suggestions.
//
// Instead of a tiny hardcoded list, we keep a broad bank of templates keyed by
// the user's learning-profile signals (favorite subjects, education level,
// learning goal, preferred language). `buildSuggestedPrompts` filters the bank
// to the profile, de-duplicates, shuffles, and returns a fresh combination each
// time — so two users (and two visits) rarely see the same set.

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

// Shown when the user hasn't completed onboarding (keeps prior behavior).
const GENERIC: SuggestedPrompt[] = [
  { text: "Explain how a B-tree index works", icon: BookOpen },
  { text: "Make a 5-question quiz on photosynthesis", icon: ListChecks },
  { text: "Summarize the key points from my notes", icon: FileText },
  { text: "Solve this maths question step by step", icon: Calculator },
  { text: "Generate practice questions on a topic", icon: PenLine },
  { text: "Teach me something fascinating today", icon: Lightbulb },
];

function subjectPrompts(subjects: string[]): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = [];
  for (const s of subjects.slice(0, 4)) {
    out.push(
      { text: `Explain ${s} simply`, icon: BookOpen },
      { text: `Create a ${s} quiz`, icon: ListChecks },
      { text: `Revise ${s} with me`, icon: Repeat },
      { text: `Generate ${s} practice questions`, icon: PenLine },
      { text: `Summarize key ${s} concepts`, icon: FileText },
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
      { text: "Explain Operating Systems", icon: BookOpen },
      { text: "Create a DBMS quiz", icon: ListChecks },
      { text: "Revise Computer Networks", icon: Repeat },
      { text: "Generate DSA interview questions", icon: PenLine },
      { text: "Explain OOP concepts with examples", icon: BookOpen },
      { text: "Quiz me on Operating Systems", icon: ListChecks },
    ],
  },
  {
    match: ["upsc", "ias"],
    prompts: [
      { text: "Explain the Indian Constitution", icon: BookOpen },
      { text: "Daily current affairs quiz", icon: ListChecks },
      { text: "Summarize Polity notes", icon: FileText },
      { text: "Explain Indian Economy basics", icon: BookOpen },
      { text: "Revise Modern Indian History", icon: Repeat },
    ],
  },
  {
    match: ["neet"],
    prompts: [
      { text: "Explain the human heart", icon: BookOpen },
      { text: "Create a Biology quiz", icon: ListChecks },
      { text: "Revise organic chemistry", icon: Repeat },
      { text: "Generate NEET physics questions", icon: PenLine },
    ],
  },
  {
    match: ["jee"],
    prompts: [
      { text: "Solve a tricky Physics problem", icon: Calculator },
      { text: "Create a JEE Maths quiz", icon: ListChecks },
      { text: "Explain rotational motion", icon: BookOpen },
      { text: "Revise coordinate geometry", icon: Repeat },
    ],
  },
  {
    match: ["11", "12", "intermediate", "+2"],
    prompts: [
      { text: "Explain integration step by step", icon: Calculator },
      { text: "Create a Physics quiz", icon: ListChecks },
      { text: "Balance this chemical equation", icon: PenLine },
      { text: "Summarize this chapter for revision", icon: FileText },
    ],
  },
  {
    match: ["6", "7", "8", "9", "10", "school"],
    prompts: [
      { text: "Solve this Maths question", icon: Calculator },
      { text: "Explain Photosynthesis", icon: BookOpen },
      { text: "Generate a Science quiz", icon: ListChecks },
      { text: "Explain Newton's laws of motion", icon: BookOpen },
    ],
  },
  {
    match: ["mba", "bba"],
    prompts: [
      { text: "Explain the marketing mix (4Ps)", icon: BookOpen },
      { text: "Create a finance quiz", icon: ListChecks },
      { text: "Summarize key economics concepts", icon: FileText },
    ],
  },
  {
    match: ["ssc", "bank", "railway"],
    prompts: [
      { text: "General knowledge quiz", icon: ListChecks },
      { text: "Quantitative aptitude practice", icon: PenLine },
      { text: "Explain Indian polity basics", icon: BookOpen },
    ],
  },
  {
    match: ["working", "professional"],
    prompts: [
      { text: "Explain a concept from my field", icon: BookOpen },
      { text: "Quiz me on a skill I'm learning", icon: ListChecks },
      { text: "Summarize an article or document", icon: FileText },
    ],
  },
];

const GOAL_GROUPS: Group[] = [
  {
    match: ["placement"],
    prompts: [
      { text: "Generate DSA interview questions", icon: PenLine },
      { text: "Explain system design basics", icon: BookOpen },
      { text: "Create an aptitude quiz", icon: ListChecks },
      { text: "Mock HR interview questions", icon: PenLine },
    ],
  },
  {
    match: ["competitive"],
    prompts: [
      { text: "Daily current affairs quiz", icon: ListChecks },
      { text: "Summarize today's important topics", icon: FileText },
      { text: "General knowledge practice questions", icon: PenLine },
    ],
  },
  {
    match: ["interview", "job"],
    prompts: [
      { text: "Common interview questions for my field", icon: PenLine },
      { text: "Practice behavioral interview answers", icon: BookOpen },
      { text: "Quiz me on core fundamentals", icon: ListChecks },
    ],
  },
  {
    match: ["school exam", "college", "exam"],
    prompts: [
      { text: "Make a revision quiz from my notes", icon: ListChecks },
      { text: "Summarize a difficult chapter", icon: FileText },
      { text: "Explain a tough concept simply", icon: BookOpen },
    ],
  },
  {
    match: ["skill"],
    prompts: [
      { text: "Give me a learning roadmap", icon: BookOpen },
      { text: "Teach me the basics, step by step", icon: PenLine },
      { text: "Quiz me to test what I learned", icon: ListChecks },
    ],
  },
  {
    match: ["personal", "interest"],
    prompts: [
      { text: "Teach me something fascinating", icon: Lightbulb },
      { text: "Explain a complex idea simply", icon: BookOpen },
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

  // Light language flavor: surface a couple of localized variants so a
  // Hindi/Hinglish learner occasionally gets prompts in their language.
  const lang = profile.preferred_language;
  if (lang && lang !== "English") {
    const subject = (profile.favorite_subjects ?? [])[0];
    pool.push({
      text: subject
        ? `Explain ${subject} in ${lang}`
        : `Explain a tough topic in ${lang}`,
      icon: Lightbulb,
    });
  }

  const unique = dedupe(pool);
  // Backfill with generic prompts if the profile produced too few.
  if (unique.length < count) unique.push(...GENERIC);
  return shuffle(dedupe(unique)).slice(0, count);
}
