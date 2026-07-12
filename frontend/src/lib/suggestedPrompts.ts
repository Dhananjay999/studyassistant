// Personalized "new chat" prompt suggestions.
//
// Instead of a tiny hardcoded list, we keep a broad bank of concrete prompts
// keyed by the user's learning-profile signals (favorite subjects, education
// level, learning goal, preferred language). `buildSuggestedPrompts` filters
// the bank to the profile, de-duplicates, shuffles, and returns a fresh
// combination each time — so two users (and two visits) rarely see the same
// set.
//
// Every prompt is written to be COMPLETE and self-contained: it names a
// concrete topic and the desired output, so clicking one almost never
// triggers a clarification round-trip. We avoid bare demonstratives ("this",
// "that") because the orchestrator asks for clarification when it can't
// resolve them.

import {
  BookOpen,
  Calculator,
  FileText,
  Layers,
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

// Small helpers keep the banks below readable.
const explain = (text: string): SuggestedPrompt => ({ text, icon: BookOpen });
const idea = (text: string): SuggestedPrompt => ({ text, icon: Lightbulb });
const quiz = (text: string): SuggestedPrompt => ({ text, icon: ListChecks });
const cards = (text: string): SuggestedPrompt => ({ text, icon: Layers });
const practice = (text: string): SuggestedPrompt => ({ text, icon: PenLine });
const summary = (text: string): SuggestedPrompt => ({ text, icon: FileText });
const solve = (text: string): SuggestedPrompt => ({ text, icon: Calculator });
const steps = (text: string): SuggestedPrompt => ({ text, icon: Repeat });

// Shown when the user hasn't completed onboarding. Concrete, fully-specified
// prompts that produce a great answer on the first click.
const GENERIC: SuggestedPrompt[] = [
  explain("Explain AI, Machine Learning, Deep Learning, and Generative AI with a comparison table"),
  explain("Teach me Large Language Models using simple examples"),
  idea("Explain today's most important AI trend in simple language"),
  explain("Explain Prompt Engineering with practical examples"),
  quiz("Create a 15-question MCQ quiz on Newton's Laws of Motion with explanations"),
  explain("Explain the OSI Model layer by layer with practical networking examples"),
  explain("Explain SQL Joins: INNER, LEFT, RIGHT, FULL OUTER, and CROSS with examples"),
  solve("Explain Quadratic Equations step by step with solved examples"),
  summary("Summarize the key concepts of photosynthesis for quick revision"),
  idea("Teach me a concept using only real-life analogies"),
  explain("Explain the difference between HTTP and HTTPS in simple terms"),
  steps("Teach Recursion using simple problems and visual call stacks"),
];

// Profile-driven prompts surfaced for every personalized user, regardless of
// subject/level matches — they lean on the profile itself.
const PERSONAL: SuggestedPrompt[] = [
  summary("Create a personalized one-hour study plan based on my learning profile"),
  idea("Recommend today's most important topic for me to study and explain why"),
  steps("Suggest the best revision strategy for long-term retention"),
  practice("Analyze common mistakes students make in competitive exams and how to avoid them"),
  idea("Act as my personal tutor and teach me one important topic from my favorite subject"),
  idea("Teach me a concept using only real-life analogies"),
];

interface Group {
  match: string[];
  prompts: SuggestedPrompt[];
}

// Matched (case-insensitive substring) against each favorite subject.
const SUBJECT_GROUPS: Group[] = [
  {
    match: ["computer science", "operating system", "dbms"],
    prompts: [
      explain("Explain CPU Scheduling (FCFS, SJF, Priority, Round Robin) with examples and a comparison table"),
      explain("Explain Virtual Memory, Paging, and Segmentation with diagrams and examples"),
      explain("Compare Processes vs Threads with pros, cons, and interview questions"),
      explain("Explain Deadlocks: prevention, avoidance, detection, and recovery with examples"),
      quiz("Create a 15-question mixed Operating Systems quiz on scheduling, memory, and deadlocks"),
      cards("Create revision flashcards on CPU Scheduling, Deadlocks, Paging, and Virtual Memory"),
      explain("Teach me DBMS Normalization from 1NF to BCNF with examples and interview questions"),
      explain("Teach ACID properties using banking transaction examples"),
      quiz("Generate a 20-question SQL quiz on joins, normalization, indexing, and subqueries"),
      cards("Create flashcards on SQL joins, keys, normalization, indexing, and transactions"),
      explain("Explain B+ Trees and database indexing with examples"),
      explain("Teach Transactions and Concurrency Control with locking and isolation levels"),
      explain("Explain the OSI Model layer by layer with practical examples"),
      summary("Compare the OSI and TCP/IP models in a table with examples"),
      explain("Explain HTTP, HTTPS, TCP, UDP, DNS, and DHCP in simple language"),
      quiz("Generate a Computer Networks quiz on OSI, TCP/IP, routing, and protocols"),
      cards("Create networking flashcards on protocols, ports, routing, and switching"),
      explain("Explain Linux file system hierarchy with examples"),
      quiz("Generate a Linux fundamentals quiz"),
      cards("Create Linux command revision flashcards"),
      explain("Explain Blockchain and Cryptocurrency for beginners"),
      explain("Teach Cloud Computing basics using AWS examples"),
    ],
  },
  {
    match: ["java", "oop"],
    prompts: [
      explain("Explain Object-Oriented Programming in Java with practical examples"),
      explain("Compare Encapsulation, Inheritance, Polymorphism, and Abstraction with real-world examples"),
      quiz("Generate a 15-question Object-Oriented Programming quiz with medium difficulty"),
      cards("Create flashcards on OOP: constructors, interfaces, inheritance, and polymorphism"),
      explain("Explain the Java Collections Framework: List, Set, Queue, and Map with examples"),
      steps("Teach Exception Handling in Java with practical examples"),
      explain("Explain Multithreading in Java using simple examples"),
    ],
  },
  {
    match: ["web development", "react", "frontend", "backend", "node"],
    prompts: [
      explain("Teach HTML, CSS, and JavaScript from scratch with examples"),
      explain("Explain the React component lifecycle and hooks with practical examples"),
      quiz("Generate a Frontend Development quiz"),
      cards("Create React revision flashcards"),
      explain("Explain Angular architecture with examples"),
      explain("Teach the Node.js Event Loop using simple examples"),
      explain("Explain MongoDB indexing and aggregation with examples"),
      quiz("Generate a Backend Development quiz"),
      cards("Create Backend Development flashcards"),
      explain("Explain REST APIs with practical examples"),
      explain("Teach Authentication vs Authorization using JWT and OAuth"),
      explain("Explain Microservices Architecture with advantages and disadvantages"),
      explain("Explain Docker and Kubernetes for beginners with real-world examples"),
    ],
  },
  {
    match: ["data structures", "algorithm", "dsa"],
    prompts: [
      explain("Explain Arrays, Linked Lists, Stacks, and Queues with diagrams and time complexity"),
      explain("Teach Trees and Binary Search Trees using visual examples"),
      explain("Explain Graph Traversal (BFS and DFS) with examples"),
      quiz("Generate a 20-question Data Structures quiz on arrays, stacks, trees, and graphs"),
      cards("Create revision flashcards for Data Structures and Algorithms"),
      steps("Explain Dynamic Programming with beginner-friendly examples"),
      steps("Teach Recursion using simple problems and visual call stacks"),
      explain("Explain Time Complexity and Big-O notation with common coding examples"),
    ],
  },
  {
    match: ["ai", "ml", "machine learning", "deep learning"],
    prompts: [
      explain("Explain AI, Machine Learning, Deep Learning, and Generative AI with comparison tables"),
      explain("Teach me Large Language Models using simple examples"),
      explain("Explain how Retrieval-Augmented Generation (RAG) works, with the architecture"),
      quiz("Generate a 15-question AI quiz covering ML, DL, NLP, and LLMs"),
      cards("Create flashcards on AI, Machine Learning, Neural Networks, and LLM terminology"),
      explain("Explain Prompt Engineering with practical examples"),
      idea("Teach Agentic AI and AI Agents using real-world scenarios"),
      solve("Explain Linear Regression with solved examples"),
      explain("Teach Decision Trees and Random Forests using simple examples"),
      explain("Explain Neural Networks for beginners"),
    ],
  },
  {
    match: ["math"],
    prompts: [
      solve("Explain Quadratic Equations step by step with solved examples"),
      explain("Teach Probability using practical real-life examples"),
      solve("Explain Integration with solved examples"),
      quiz("Generate a Mathematics quiz covering Algebra, Calculus, and Probability"),
      cards("Create Mathematics revision flashcards covering formulas and shortcuts"),
    ],
  },
  {
    match: ["physics"],
    prompts: [
      explain("Explain Newton's Laws with real-life examples"),
      quiz("Generate a Physics and Chemistry mixed quiz"),
    ],
  },
  {
    match: ["chemistry"],
    prompts: [
      explain("Teach Chemical Bonding using easy diagrams"),
      quiz("Generate a Physics and Chemistry mixed quiz"),
    ],
  },
  {
    match: ["biology"],
    prompts: [
      explain("Explain Photosynthesis in a way suitable for board exams"),
      cards("Create Biology flashcards on Genetics, Cell Structure, and Human Physiology"),
    ],
  },
  {
    match: ["history"],
    prompts: [
      explain("Explain the French Revolution with a timeline and key events"),
      explain("Teach World War II using maps and timelines"),
    ],
  },
  {
    match: ["economics"],
    prompts: [
      explain("Explain Inflation and GDP using practical examples"),
      quiz("Generate an Economics practice quiz"),
      cards("Create Economics revision flashcards"),
    ],
  },
];

// Matched by case-insensitive substring against the (possibly free-text) level.
const LEVEL_GROUPS: Group[] = [
  {
    match: ["b.tech", "btech", "engineering", "diploma", "m.tech", "mtech", "b.sc"],
    prompts: [
      explain("Explain CPU Scheduling (FCFS, SJF, Priority, Round Robin) with examples and a comparison table"),
      explain("Teach me DBMS Normalization from 1NF to BCNF with examples and interview questions"),
      explain("Explain Deadlocks: prevention, avoidance, detection, and recovery with examples"),
      quiz("Create a 15-question mixed Operating Systems quiz on scheduling, memory, and deadlocks"),
      explain("Explain SQL Joins: INNER, LEFT, RIGHT, FULL OUTER, and CROSS with examples"),
      quiz("Generate a 20-question SQL quiz on joins, normalization, indexing, and subqueries"),
      explain("Explain Arrays, Linked Lists, Stacks, and Queues with diagrams and time complexity"),
      quiz("Generate a Computer Networks quiz on OSI, TCP/IP, routing, and protocols"),
      explain("Compare Encapsulation, Inheritance, Polymorphism, and Abstraction with examples"),
      explain("Teach Git and GitHub workflows using practical examples"),
      quiz("Generate a Git and GitHub practice quiz"),
      cards("Create Git revision flashcards"),
      explain("Teach System Design basics with practical examples"),
      explain("Explain Load Balancers, Caching, and CDNs using real-world systems"),
      quiz("Generate a System Design quiz with beginner and intermediate questions"),
    ],
  },
  {
    match: ["upsc", "ias"],
    prompts: [
      explain("Explain Fundamental Rights and Directive Principles with examples"),
      explain("Teach Indian Economy basics for UPSC beginners"),
      quiz("Generate a 20-question UPSC Polity quiz"),
      cards("Create UPSC revision flashcards on Polity, Economy, Geography, and History"),
      explain("Explain the French Revolution with a timeline and key events"),
      explain("Explain Inflation and GDP using practical examples"),
    ],
  },
  {
    match: ["neet"],
    prompts: [
      explain("Explain the structure and working of the human heart with a diagram description"),
      quiz("Create a 20-question Biology quiz on the human digestive system with explanations"),
      explain("Teach Chemical Bonding using easy diagrams"),
      cards("Create Biology flashcards on Genetics, Cell Structure, and Human Physiology"),
      practice("Give me 10 NEET Physics practice questions on optics with solutions"),
    ],
  },
  {
    match: ["jee"],
    prompts: [
      solve("Solve a tough JEE Physics problem on rotational motion step by step"),
      quiz("Create a 15-question JEE Maths quiz on calculus with solutions"),
      solve("Explain Integration with solved examples"),
      explain("Teach Probability using practical real-life examples"),
      practice("Give me 10 coordinate geometry practice questions with step-by-step answers"),
    ],
  },
  {
    match: ["11", "12", "intermediate", "+2"],
    prompts: [
      solve("Explain Integration with solved examples"),
      solve("Explain Quadratic Equations step by step with solved examples"),
      explain("Teach Probability using practical real-life examples"),
      explain("Teach Chemical Bonding using easy diagrams"),
      quiz("Generate a Mathematics quiz covering Algebra, Calculus, and Probability"),
      cards("Create Mathematics revision flashcards covering formulas and shortcuts"),
      quiz("Generate a Physics and Chemistry mixed quiz"),
    ],
  },
  {
    match: ["6", "7", "8", "9", "10", "school"],
    prompts: [
      explain("Explain Newton's Laws with real-life examples"),
      explain("Explain Photosynthesis in a way suitable for board exams"),
      quiz("Create a 10-question Science quiz on the water cycle with explanations"),
      practice("Give me 10 practice questions on fractions with step-by-step solutions"),
      explain("Teach English Grammar focusing on Tenses, Voice, and Narration"),
    ],
  },
  {
    match: ["mba", "bba"],
    prompts: [
      explain("Explain the marketing mix (4Ps) with a real company example"),
      explain("Explain Inflation and GDP using practical examples"),
      quiz("Generate an Economics practice quiz"),
      summary("Summarize key microeconomics concepts (demand, supply, elasticity)"),
    ],
  },
  {
    match: ["ssc", "bank", "railway"],
    prompts: [
      practice("Teach Quantitative Aptitude shortcuts for SSC examinations"),
      quiz("Generate a Logical Reasoning practice quiz with medium difficulty"),
      cards("Create SSC aptitude flashcards"),
      explain("Teach English Grammar focusing on Tenses, Voice, and Narration"),
      quiz("Generate an English Grammar quiz with explanations"),
      cards("Create English vocabulary flashcards for competitive exams"),
    ],
  },
  {
    match: ["working", "professional"],
    prompts: [
      explain("Teach System Design basics with practical examples"),
      explain("Explain Docker and Kubernetes for beginners with real-world examples"),
      explain("Teach Cloud Computing basics using AWS examples"),
      idea("Explain today's most important AI trend in simple language"),
      explain("Explain Microservices Architecture with advantages and disadvantages"),
    ],
  },
];

const GOAL_GROUPS: Group[] = [
  {
    match: ["placement"],
    prompts: [
      quiz("Generate a coding interview quiz covering OS, DBMS, Networks, and OOP"),
      cards("Create flashcards for coding interview preparation"),
      practice("Give me the top 15 DSA interview questions with solutions"),
      explain("Teach System Design basics with practical examples"),
      explain("Explain Load Balancers, Caching, and CDNs using real-world systems"),
      practice("Give me common HR interview questions with sample answers"),
    ],
  },
  {
    match: ["competitive"],
    prompts: [
      practice("Teach Quantitative Aptitude shortcuts for SSC examinations"),
      quiz("Generate a Logical Reasoning practice quiz with medium difficulty"),
      cards("Create English vocabulary flashcards for competitive exams"),
      quiz("Generate an English Grammar quiz with explanations"),
      practice("Analyze common mistakes students make in competitive exams and how to avoid them"),
    ],
  },
  {
    match: ["interview", "job"],
    prompts: [
      quiz("Generate a coding interview quiz covering OS, DBMS, Networks, and OOP"),
      cards("Create flashcards for coding interview preparation"),
      explain("Explain how to answer behavioral interview questions using the STAR method"),
      practice("Give me the top 10 interview questions for my field with sample answers"),
    ],
  },
  {
    match: ["school exam", "college", "exam"],
    prompts: [
      quiz("Create a 15-question revision quiz on my favorite subject with explanations"),
      steps("Suggest the best revision strategy for long-term retention"),
      summary("Summarize the most important formulas and definitions for revision"),
      idea("Recommend today's most important topic for me to study and explain why"),
    ],
  },
  {
    match: ["skill"],
    prompts: [
      explain("Teach Git and GitHub workflows using practical examples"),
      explain("Explain Docker and Kubernetes for beginners with real-world examples"),
      explain("Teach Cloud Computing basics using AWS examples"),
      summary("Give me a step-by-step 30-day learning roadmap for a new skill"),
      explain("Teach HTML, CSS, and JavaScript from scratch with examples"),
    ],
  },
  {
    match: ["personal", "interest"],
    prompts: [
      idea("Teach me a concept using only real-life analogies"),
      idea("Explain today's most important AI trend in simple language"),
      explain("Explain Blockchain and Cryptocurrency for beginners"),
      idea("Teach me a fascinating concept and explain why it matters"),
    ],
  },
];

function subjectPrompts(subjects: string[]): SuggestedPrompt[] {
  const out: SuggestedPrompt[] = [];
  for (const s of subjects.slice(0, 4)) {
    // Curated prompts for known subjects first…
    out.push(...collectGroups(s, SUBJECT_GROUPS));
    // …plus generic templates so free-text subjects still get suggestions.
    out.push(
      explain(`Explain the core concepts of ${s} with real-world examples`),
      quiz(`Create a 15-question MCQ quiz on ${s} with explanations`),
      practice(`Give me the most important ${s} interview questions with answers`),
      cards(`Create revision flashcards for the key ${s} topics`),
    );
  }
  return out;
}

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
  // Profile-aware universal prompts (study plan, revision strategy, tutor).
  pool.push(...shuffle(PERSONAL).slice(0, 2));

  // Light language flavor: surface a localized variant so a Hindi/Hinglish
  // learner occasionally gets a fully-formed prompt in their language.
  const lang = profile.preferred_language;
  if (lang && lang !== "English") {
    const subject = (profile.favorite_subjects ?? [])[0];
    pool.push(
      idea(
        subject
          ? `Explain the core concepts of ${subject} in ${lang} with examples`
          : `Explain a tough topic in ${lang} with simple examples`,
      ),
    );
  }

  const unique = dedupe(pool);
  // Backfill with generic prompts if the profile produced too few.
  if (unique.length < count) unique.push(...GENERIC);
  return shuffle(dedupe(unique)).slice(0, count);
}
