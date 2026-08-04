// Scripted conversations for the landing-page hero demo. Each one showcases a
// different capability (web answers, PDF chat, quizzes, flashcards, code,
// study plans) and is replayed with a fake streaming animation so the card
// feels like a live session with Aeva. No backend is involved — everything
// here is display data.

import type { ThinkingHint } from "@/lib/loadingMessages";

export interface DemoSource {
  kind: "web" | "doc";
  title: string;
  /** Web sources: bare domain used for the favicon + label. */
  domain?: string;
  /** Doc sources: cited page number shown on the chip. */
  page?: number;
  /** Doc sources: tooltip snippet, like the real citation chips. */
  snippet?: string;
}

export interface DemoQuizQuestion {
  question: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
}

export interface DemoQuiz {
  title: string;
  count: number;
  mins: number;
  difficulty: string;
  /** Exam-mode badge (e.g. "NEET"); plain "Quiz" badge when absent. */
  examLabel?: string;
  /** 1–2 sample questions for the interactive preview. */
  questions: DemoQuizQuestion[];
}

export interface DemoFlashcards {
  title: string;
  count: number;
  /** Sample cards for the interactive flip preview. */
  cards: { front: string; back: string }[];
}

/** Action chips rendered under the finished answer (mirrors PRIMARY_ACTIONS). */
export type DemoActionId =
  | "quiz"
  | "flashcards"
  | "summary"
  | "simpler"
  | "detail"
  | "plan";

export interface DemoConversation {
  id: string;
  /** Short context label shown in the demo header, e.g. "School · Biology". */
  category: string;
  /** Which thinking skeleton/copy to show while "Aeva" works. */
  hint: ThinkingHint;
  /** Tool badge on the answer bubble ("Web" | "Notes" | "Quiz"), if any. */
  toolBadge?: string;
  user: string;
  /** Mini-markdown: **bold**, `code`, ``` fences, "- " bullets, "1. " lists. */
  answer: string;
  sources?: DemoSource[];
  actions: DemoActionId[];
  followups?: string[];
  quiz?: DemoQuiz;
  /** Reveal the quiz card automatically after the answer (quiz-led demos). */
  autoQuiz?: boolean;
  flashcards?: DemoFlashcards;
}

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: "school-photosynthesis",
    category: "School · Biology",
    hint: "web",
    toolBadge: "Web",
    user: "Explain photosynthesis with a simple diagram.",
    answer:
      "Photosynthesis is how plants turn sunlight into food. It happens in " +
      "the **chloroplasts** of leaf cells.\n\n" +
      "```\n" +
      "        Sunlight\n" +
      "           │\n" +
      "           ▼\n" +
      "6CO₂  +  6H₂O  ──►  C₆H₁₂O₆  +  6O₂\n" +
      "(air)   (roots)     (glucose)  (released)\n" +
      "```\n\n" +
      "- **Light reactions** — chlorophyll captures sunlight and splits water\n" +
      "- **Calvin cycle** — carbon dioxide is fixed into glucose\n\n" +
      "So plants make their own food and release the oxygen we breathe.",
    sources: [
      {
        kind: "web",
        domain: "khanacademy.org",
        title: "Photosynthesis — Khan Academy",
      },
      {
        kind: "web",
        domain: "britannica.com",
        title: "Photosynthesis | Definition, Process & Equation",
      },
    ],
    actions: ["quiz", "flashcards", "summary"],
    followups: [
      "Why do leaves look green?",
      "What limits the rate of photosynthesis?",
    ],
    quiz: {
      title: "Quiz: Photosynthesis",
      count: 10,
      mins: 20,
      difficulty: "medium",
      questions: [
        {
          question: "Where do the light reactions of photosynthesis occur?",
          options: [
            "Thylakoid membranes",
            "Stroma",
            "Mitochondrial matrix",
            "Cell wall",
          ],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: Photosynthesis",
      count: 12,
      cards: [
        {
          front: "What pigment captures light energy?",
          back: "Chlorophyll — found in the thylakoid membranes of chloroplasts.",
        },
        {
          front: "Overall equation of photosynthesis?",
          back: "6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂",
        },
        {
          front: "What does the Calvin cycle produce?",
          back: "Glucose — by fixing CO₂ using ATP and NADPH.",
        },
      ],
    },
  },
  {
    id: "college-deadlocks",
    category: "College · Operating Systems",
    hint: "thinking",
    user: "Explain deadlocks in Operating Systems with an example.",
    answer:
      "A **deadlock** is when processes wait on each other forever — none can " +
      "proceed. All four *Coffman conditions* must hold:\n\n" +
      "- **Mutual exclusion** — a resource is held by one process at a time\n" +
      "- **Hold and wait** — holding one resource while waiting for another\n" +
      "- **No preemption** — resources can't be forcibly taken away\n" +
      "- **Circular wait** — a cycle of processes each waiting on the next\n\n" +
      "**Example:** `P1` holds the *printer* and needs the *scanner*, while " +
      "`P2` holds the *scanner* and needs the *printer*. Each waits on the " +
      "other — deadlock. Break any one condition (e.g. request all resources " +
      "up front) and it can't happen.",
    actions: ["quiz", "flashcards", "detail"],
    followups: [
      "Explain memory management next",
      "How does the Banker's algorithm avoid deadlock?",
    ],
    quiz: {
      title: "Quiz: Deadlocks in OS",
      count: 10,
      mins: 20,
      difficulty: "medium",
      questions: [
        {
          question:
            "Which condition, if removed, guarantees deadlock cannot occur?",
          options: [
            "Any one of the four Coffman conditions",
            "Only mutual exclusion",
            "Only circular wait",
            "None — deadlocks are unavoidable",
          ],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: Deadlocks",
      count: 10,
      cards: [
        {
          front: "Name the four Coffman conditions.",
          back: "Mutual exclusion, hold & wait, no preemption, circular wait.",
        },
        {
          front: "What does the Banker's algorithm do?",
          back: "Grants resource requests only if the system stays in a safe state.",
        },
        {
          front: "Deadlock vs starvation?",
          back: "Deadlock: no process can proceed. Starvation: one process never gets a turn.",
        },
      ],
    },
  },
  {
    id: "neet-biology-quiz",
    category: "Exam Prep · NEET",
    hint: "quiz",
    toolBadge: "Quiz",
    user: "Create a 15-question NEET Biology quiz on Human Physiology.",
    answer:
      "Done! Here's your **15-question NEET-style quiz** on Human Physiology " +
      "— single-correct MCQs with NEET marking (**+4 / −1**) and a real exam " +
      "timer.\n\n" +
      "- Mix of **easy, moderate and assertion–reason** questions\n" +
      "- Covers breathing, circulation, excretion and neural control\n" +
      "- Detailed solutions and AI feedback after you submit\n\n" +
      "Open it when you're ready. Good luck! 🎯",
    actions: ["flashcards"],
    autoQuiz: true,
    quiz: {
      title: "NEET Biology · Human Physiology",
      count: 15,
      mins: 22,
      difficulty: "hard",
      examLabel: "NEET",
      questions: [
        {
          question:
            "Which part of the nephron is impermeable to water?",
          options: [
            "Ascending limb of the loop of Henle",
            "Proximal convoluted tubule",
            "Descending limb of the loop of Henle",
            "Collecting duct",
          ],
          answer: 0,
        },
        {
          question: "The pacemaker of the human heart is the:",
          options: [
            "Sinoatrial node",
            "Atrioventricular node",
            "Bundle of His",
            "Purkinje fibres",
          ],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: Human Physiology",
      count: 15,
      cards: [
        {
          front: "Normal cardiac output in a healthy adult?",
          back: "≈ 5 litres per minute (70 mL stroke volume × 72 bpm).",
        },
        {
          front: "Which cells secrete insulin?",
          back: "β-cells of the islets of Langerhans in the pancreas.",
        },
        {
          front: "Site of gas exchange in the lungs?",
          back: "Alveoli — thin-walled sacs wrapped in capillaries.",
        },
      ],
    },
  },
  {
    id: "programming-react-hooks",
    category: "Programming · React",
    hint: "thinking",
    user: "Explain React hooks with an example.",
    answer:
      "**Hooks** let function components hold state and run side-effects — " +
      "no classes needed.\n\n" +
      "```jsx\n" +
      "function Counter() {\n" +
      "  const [count, setCount] = useState(0);\n\n" +
      "  return (\n" +
      "    <button onClick={() => setCount(count + 1)}>\n" +
      "      Clicked {count} times\n" +
      "    </button>\n" +
      "  );\n" +
      "}\n" +
      "```\n\n" +
      "- `useState` — local state that survives re-renders\n" +
      "- `useEffect` — run code after render (fetching, timers)\n" +
      "- **Custom hooks** — extract and share logic between components",
    actions: ["quiz", "flashcards", "detail"],
    followups: [
      "What are the rules of hooks?",
      "When should I use useMemo?",
    ],
    quiz: {
      title: "Quiz: React Hooks",
      count: 10,
      mins: 20,
      difficulty: "medium",
      questions: [
        {
          question: "Why must hooks be called at the top level of a component?",
          options: [
            "So hook order is identical on every render",
            "To make the bundle smaller",
            "Because JSX requires it",
            "To avoid CSS conflicts",
          ],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: React Hooks",
      count: 8,
      cards: [
        {
          front: "What does useState return?",
          back: "A pair: the current state value and a setter function.",
        },
        {
          front: "When does useEffect with [] run?",
          back: "Once after the first render — like componentDidMount.",
        },
        {
          front: "What is a custom hook?",
          back: "A function starting with `use` that composes other hooks to share logic.",
        },
      ],
    },
  },
  {
    id: "pdf-chemistry-notes",
    category: "PDF Chat · Your Notes",
    hint: "media",
    toolBadge: "Notes",
    user: "Summarize my uploaded chemistry notes.",
    answer:
      "I read **Chemistry_Ch4_Bonding.pdf** — here's what your notes cover:\n\n" +
      "- **Chemical bonding** — ionic vs covalent, with Lewis dot structures\n" +
      "- **VSEPR theory** — predicting molecular shapes from electron pairs\n" +
      "- **Hybridisation** — sp, sp² and sp³ with CH₄ and C₂H₄ examples\n" +
      "- **Hydrogen bonding** — why water boils far above H₂S\n\n" +
      "The shape-prediction table on **page 5** looks exam-critical — want a " +
      "quiz built just from your notes?",
    sources: [
      {
        kind: "doc",
        title: "Chemistry_Ch4_Bonding.pdf",
        page: 2,
        snippet: "Ionic bonds form by complete electron transfer…",
      },
      {
        kind: "doc",
        title: "Chemistry_Ch4_Bonding.pdf",
        page: 5,
        snippet: "VSEPR: electron pairs arrange to minimise repulsion…",
      },
      {
        kind: "doc",
        title: "Chemistry_Ch4_Bonding.pdf",
        page: 9,
        snippet: "Hydrogen bonding raises the boiling point of water…",
      },
    ],
    actions: ["quiz", "flashcards"],
    followups: [
      "Explain VSEPR theory from my notes",
      "Which topics am I weakest in?",
    ],
    quiz: {
      title: "Quiz: Chemical Bonding (from your notes)",
      count: 10,
      mins: 20,
      difficulty: "medium",
      questions: [
        {
          question:
            "According to VSEPR theory, the shape of methane (CH₄) is:",
          options: ["Tetrahedral", "Trigonal planar", "Linear", "Bent"],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: Chemical Bonding",
      count: 12,
      cards: [
        {
          front: "Hybridisation of carbon in C₂H₄?",
          back: "sp² — three sigma bonds and one pi bond.",
        },
        {
          front: "What does VSEPR predict?",
          back: "Molecular shape — electron pairs arrange to minimise repulsion.",
        },
        {
          front: "Why does water boil above H₂S?",
          back: "Strong hydrogen bonding between H₂O molecules.",
        },
      ],
    },
  },
  {
    id: "tutor-physics-test",
    category: "AI Tutor · Study Plan",
    hint: "thinking",
    user: "Help me prepare for tomorrow's Physics test on electromagnetism.",
    answer:
      "Let's make tonight count. Here's a focused **90-minute revision " +
      "plan**:\n\n" +
      "1. **Faraday's & Lenz's laws** — 25 min · re-derive the flux rule, " +
      "then 5 practice problems\n" +
      "2. **Motional EMF** — 20 min · rod-on-rails setups and induced current " +
      "direction\n" +
      "3. **Inductance & LR circuits** — 25 min · time constants and stored " +
      "energy\n" +
      "4. **Rapid-fire recap** — 20 min · flashcards, then a 10-question " +
      "quiz\n\n" +
      "Start with step 1 — I'll quiz you after each block. You've got this! 💪",
    actions: ["quiz", "flashcards", "simpler"],
    followups: [
      "Quiz me on Faraday's law now",
      "Make flashcards for the formulas",
    ],
    quiz: {
      title: "Quiz: Electromagnetism",
      count: 10,
      mins: 20,
      difficulty: "medium",
      questions: [
        {
          question:
            "Lenz's law says an induced current always flows so that it:",
          options: [
            "Opposes the change in magnetic flux",
            "Increases the magnetic flux",
            "Aligns with the external field",
            "Minimises circuit resistance",
          ],
          answer: 0,
        },
      ],
    },
    flashcards: {
      title: "Flashcards: Electromagnetism",
      count: 10,
      cards: [
        {
          front: "Faraday's law (formula)?",
          back: "EMF = −dΦ/dt — induced EMF equals the rate of change of flux.",
        },
        {
          front: "Energy stored in an inductor?",
          back: "U = ½ L I²",
        },
        {
          front: "Time constant of an LR circuit?",
          back: "τ = L / R",
        },
      ],
    },
  },
];
