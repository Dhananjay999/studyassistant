// Slash commands surfaced in the composer when the input starts with "/".
// Most commands insert a starter template the user completes and sends; /quiz
// opens the quiz-setup flow instead.

import {
  FileText,
  Languages,
  Layers,
  ListChecks,
  Microscope,
  NotebookPen,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface SlashCommand {
  id: string;
  /** Displayed trigger, e.g. "/summarize". */
  label: string;
  description: string;
  icon: LucideIcon;
  /** Text inserted into the composer (empty for action commands). */
  template: string;
  /** Special handling instead of inserting a template. */
  action?: "quiz";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "quiz",
    label: "/quiz",
    description: "Generate a quiz",
    icon: ListChecks,
    template: "",
    action: "quiz",
  },
  {
    id: "flashcards",
    label: "/flashcards",
    description: "Generate study flashcards",
    icon: Layers,
    template: "Create flashcards on ",
  },
  {
    id: "summarize",
    label: "/summarize",
    description: "Summarize a topic or your last answer",
    icon: FileText,
    template: "Summarize ",
  },
  {
    id: "translate",
    label: "/translate",
    description: "Translate text into another language",
    icon: Languages,
    template: "Translate the following into English: ",
  },
  {
    id: "studyplan",
    label: "/studyplan",
    description: "Build a structured study plan",
    icon: ScrollText,
    template: "Create a detailed study plan for ",
  },
  {
    id: "analyze",
    label: "/analyze",
    description: "Analyze a topic in depth",
    icon: Microscope,
    template: "Analyze ",
  },
  {
    id: "explain",
    label: "/explain",
    description: "Explain a concept clearly",
    icon: Sparkles,
    template: "Explain ",
  },
  {
    id: "notes",
    label: "/notes",
    description: "Make concise study notes",
    icon: NotebookPen,
    template: "Make concise, well-structured study notes on ",
  },
];

/** Filter commands by the text typed after the leading slash. */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.replace(/^\//, "").trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) =>
      c.id.includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
  );
}
