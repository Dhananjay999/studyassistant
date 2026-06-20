// Contextual actions shown below each completed assistant answer.
// Primary actions (prominent chips) lead with Quiz — the core product feature.
// Prompt actions send a short instruction; the orchestrator already has the
// prior answer in its conversation history, so we don't inline the response.

import {
  FileText,
  Maximize2,
  Microscope,
  Minimize2,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface PrimaryAction {
  id: string;
  label: string;
  icon: LucideIcon;
  kind: "prompt" | "quiz";
  /**
   * Builds the instruction for kind === "prompt". The specific card's content
   * is embedded so the action always operates on THAT response — never the
   * latest conversation state.
   */
  buildPrompt?: (content: string) => string;
  /** Visually emphasized (the quiz CTA). */
  highlight?: boolean;
}

// Keep the embedded content bounded so the request stays reasonable.
const MAX_CONTEXT = 6000;
const ctx = (content: string): string =>
  content.length > MAX_CONTEXT ? `${content.slice(0, MAX_CONTEXT)}…` : content;

const withContent = (instruction: string) => (content: string): string =>
  `${instruction}\n\nUse ONLY the following content as the source — ignore ` +
  `any later messages in this conversation:\n\n"""\n${ctx(content)}\n"""`;

export const PRIMARY_ACTIONS: PrimaryAction[] = [
  {
    id: "create_quiz",
    label: "Create Quiz",
    icon: Sparkles,
    kind: "quiz",
    highlight: true,
  },
  {
    id: "explain_simpler",
    label: "Explain Simpler",
    icon: Minimize2,
    kind: "prompt",
    buildPrompt: withContent(
      "Re-explain the following content in simpler terms that a beginner " +
        "can easily understand. Use plain language and a short example.",
    ),
  },
  {
    id: "explain_detail",
    label: "Explain in Detail",
    icon: Maximize2,
    kind: "prompt",
    buildPrompt: withContent(
      "Expand on the following content with more detail, context, and " +
        "concrete examples.",
    ),
  },
  {
    id: "summarize",
    label: "Summarize",
    icon: FileText,
    kind: "prompt",
    buildPrompt: withContent(
      "Summarize the following content into concise bullet points.",
    ),
  },
  {
    id: "study_plan",
    label: "Study Plan",
    icon: ScrollText,
    kind: "prompt",
    buildPrompt: withContent(
      "Create a structured study plan to master the topic in the following " +
        "content — clear steps, ordered milestones, and rough time estimates.",
    ),
  },
  {
    id: "analyze",
    label: "Analyze Topic",
    icon: Microscope,
    kind: "prompt",
    buildPrompt: withContent(
      "Analyze the topic in the following content in depth: key points, why " +
        "they matter, common pitfalls, and how the ideas connect.",
    ),
  },
];
