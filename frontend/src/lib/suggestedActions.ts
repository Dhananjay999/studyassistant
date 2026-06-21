// Contextual actions shown below each completed assistant answer.
// Every action operates ONLY on the card it belongs to: the chip sends a short
// instruction plus that card's content as `source_content` (see ChatPage),
// never the latest conversation state.

import {
  FileText,
  Layers,
  Maximize2,
  Microscope,
  Minimize2,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type ActionKind = "prompt" | "quiz" | "flashcards";

export interface PrimaryAction {
  id: string;
  /** Backend action key (from response.available_actions) this maps to. */
  key: string;
  label: string;
  icon: LucideIcon;
  kind: ActionKind;
  /** Short instruction sent as the message for kind === "prompt". */
  instruction?: string;
  /** Visually emphasized, border-only "premium" chip. */
  highlight?: boolean;
}

export const PRIMARY_ACTIONS: PrimaryAction[] = [
  {
    id: "create_quiz",
    key: "QUIZ",
    label: "Create Quiz",
    icon: Sparkles,
    kind: "quiz",
    highlight: true,
  },
  {
    id: "create_flashcards",
    key: "FLASHCARDS",
    label: "Create Flashcards",
    icon: Layers,
    kind: "flashcards",
    highlight: true,
  },
  {
    id: "explain_simpler",
    key: "SIMPLIFY",
    label: "Explain Simpler",
    icon: Minimize2,
    kind: "prompt",
    instruction:
      "Re-explain this in simpler terms for a beginner, with a short example.",
  },
  {
    id: "explain_detail",
    key: "DETAIL",
    label: "Explain in Detail",
    icon: Maximize2,
    kind: "prompt",
    instruction: "Explain this in more depth, with context and examples.",
  },
  {
    id: "summarize",
    key: "SUMMARY",
    label: "Summarize",
    icon: FileText,
    kind: "prompt",
    instruction: "Summarize this into concise bullet points.",
  },
  {
    id: "study_plan",
    key: "STUDY_PLAN",
    label: "Study Plan",
    icon: ScrollText,
    kind: "prompt",
    instruction:
      "Create a structured study plan to master this, with steps and " +
      "rough time estimates.",
  },
  {
    id: "analyze",
    key: "ANALYZE",
    label: "Analyze Topic",
    icon: Microscope,
    kind: "prompt",
    instruction:
      "Analyze this topic in depth: key points, why they matter, and " +
      "common pitfalls.",
  },
];
