// One mapper from the backend's turn result (`done` frame content, or the
// persisted `metadata.content`) to the UI's message meta. The live stream and
// the history loader both go through it, so a reloaded conversation renders
// exactly like it did live.
//
// Turn results come in two shapes:
//   - single-agent: the tool's own result, flat. A quiz turn's content IS the
//     quiz (`questions` at the top level) — the shape every stored message
//     before multi-agent turns has.
//   - multi-agent: an answer plus nested artifacts (`content.quiz`,
//     `content.flashcards`, `content.images`) and the agent roster.
// Nested artifacts win; the flat shape is the fallback keyed on `tool_used`.

import { normalizeAgents } from "@/lib/agents";
import type {
  FlashcardContent,
  MessageMeta,
  QuizContent,
  ToolUsed,
} from "@/types";

type Content = Record<string, unknown>;

function isQuiz(value: unknown): value is QuizContent {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { questions?: unknown }).questions)
  );
}

function isFlashcards(value: unknown): value is FlashcardContent {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { cards?: unknown }).cards)
  );
}

export function mapAssistantContent(
  content: Content,
  toolUsed: ToolUsed | undefined,
): MessageMeta {
  const quiz = isQuiz(content.quiz)
    ? content.quiz
    : toolUsed === "quiz_generator" && isQuiz(content)
      ? content
      : undefined;
  const flashcards = isFlashcards(content.flashcards)
    ? content.flashcards
    : toolUsed === "flashcard_generator" && isFlashcards(content)
      ? content
      : undefined;

  const toolsUsed = Array.isArray(content.tools_used)
    ? (content.tools_used.filter((t) => typeof t === "string") as ToolUsed[])
    : toolUsed
      ? [toolUsed]
      : [];
  const agents = normalizeAgents(content.agents);

  return {
    tool_used: toolUsed,
    tools_used: toolsUsed,
    // A roster is only worth showing when more than one agent worked.
    agents: agents.length > 1 ? agents : undefined,
    parallel: content.parallel === true,
    sources: (content.sources as MessageMeta["sources"]) || [],
    // Present only for Developer Mode users (the backend attaches them).
    model: content.model as string | undefined,
    debug: content.debug as MessageMeta["debug"],
    images: content.images as MessageMeta["images"],
    quiz,
    flashcards,
    available_actions: content.available_actions as string[] | undefined,
    suggested_followups:
      content.suggested_followups as MessageMeta["suggested_followups"],
    response_type: content.response_type as string | undefined,
  };
}

/** True when a turn ran more than one agent. */
export function isTeamTurn(meta: MessageMeta | undefined): boolean {
  return (meta?.agents?.length ?? 0) > 1;
}
