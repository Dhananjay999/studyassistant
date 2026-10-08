// The Exam Prep conversation scoped to one topic (the doubt box of the topic
// page). Streams through `/exam-prep/plan/:id/chat/stream` with the same SSE
// frames as chat, so ChatMessages / ChatComposer render it unchanged. History
// is the topic's own turns (`?topic_id=`), seeded once; every turn carries
// `topic_id` + `day_id` so the coach answers with the lesson in context.

import { useCallback, useEffect, useRef, useState } from "react";
import { useExamMessages } from "@/hooks/api";
import { useAssistantStream } from "@/hooks/useAssistantStream";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { examChatStreamUrl } from "@/lib/api";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import { TOOL_TO_HINT, type ThinkingHint } from "@/lib/loadingMessages";
import { mapAssistantContent } from "@/lib/messageMeta";
import type {
  ExamChatRequest,
  Message,
  QuizOptions,
  ToolUsed,
} from "@/types";

const uid = () => crypto.randomUUID();

export type ExamSendIntent = "text" | "quiz" | "flashcards" | "followup";

export interface ExamSendOptions {
  intent?: ExamSendIntent;
  quizOptions?: QuizOptions;
  flashcardOptions?: { count?: number };
  /** What the user bubble shows when the outgoing text carries extra context. */
  displayText?: string;
}

export interface ExamConversation {
  messages: Message[];
  send: (text: string, opts?: ExamSendOptions) => void;
  /** Re-send the turn that produced the failed assistant message. */
  retry: (messageId: string) => void;
  streaming: boolean;
  thinkingHint: ThinkingHint | undefined;
  historyLoading: boolean;
}

export function useExamConversation({
  planId,
  topicId,
  dayId,
  mediaIds,
}: {
  planId: string;
  topicId: string;
  dayId: string;
  /** Uploads selected as context; read at send time so a toggle made
   *  between turns applies to the next turn without re-creating `send`. */
  mediaIds?: React.MutableRefObject<string[]>;
}): ExamConversation {
  const history = useExamMessages(planId, topicId);
  const { start, streaming } = useAssistantStream(examChatStreamUrl(planId));

  const [messages, setMessages] = useState<Message[]>([]);
  const [thinkingHint, setThinkingHint] = useState<ThinkingHint | undefined>();
  const seededRef = useRef(false);
  const retryHandlers = useRef(new Map<string, () => void>());
  // Latest messages for `retry`, which must not read state inside an updater
  // (StrictMode runs updaters twice and would send twice).
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // History is loaded once; anything sent before it arrived stays after it.
  useEffect(() => {
    if (!history.data || seededRef.current) return;
    seededRef.current = true;
    const loaded = history.data;
    setMessages((prev) => [...loaded, ...prev]);
  }, [history.data]);

  const send = useCallback(
    (text: string, opts: ExamSendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const sentAt = performance.now();
      let firstChunkAt: number | null = null;
      const intent: ExamSendIntent =
        opts.intent ??
        (opts.quizOptions
          ? "quiz"
          : opts.flashcardOptions
            ? "flashcards"
            : "text");
      const display = opts.displayText ?? trimmed;

      const contextIds = mediaIds?.current ?? [];
      analytics.track(AnalyticsEvent.EXAM_PREP_MESSAGE_SENT, {
        plan_id: planId,
        message_length: trimmed.length,
        has_topic: true,
        has_day: true,
        intent,
        media_count: contextIds.length,
      });

      const streamId = `stream-${uid()}`;
      const userMsgId = uid();
      setThinkingHint(
        opts.flashcardOptions
          ? "flashcard"
          : opts.quizOptions
            ? "quiz"
            : "thinking",
      );
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: "user",
          content: display,
          createdAt: new Date(),
        },
        {
          id: streamId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
          streaming: true,
        },
      ]);

      const body: ExamChatRequest = {
        message: trimmed,
        topic_id: topicId,
        day_id: dayId,
        ...(contextIds.length ? { media_ids: contextIds } : {}),
        ...(opts.quizOptions ? { quiz_options: opts.quizOptions } : {}),
        ...(opts.flashcardOptions
          ? { flashcard_options: opts.flashcardOptions }
          : {}),
      };

      const dropTurn = () => {
        setThinkingHint(undefined);
        setMessages((prev) => prev.filter((m) => m.id !== streamId));
      };

      void start(body, {
        onChunk: (delta) => {
          if (firstChunkAt === null) firstChunkAt = performance.now();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId ? { ...m, content: m.content + delta } : m,
            ),
          );
        },
        onToolSelected: (tool) => {
          setThinkingHint(TOOL_TO_HINT[tool] ?? "thinking");
        },
        onComplete: (full, meta) => {
          const content = (meta.content ?? {}) as Record<string, unknown>;
          const toolUsed = meta.tool_used as ToolUsed | undefined;
          const mapped = mapAssistantContent(content, toolUsed);
          analytics.track(AnalyticsEvent.EXAM_PREP_RESPONSE_COMPLETED, {
            plan_id: planId,
            tool_used: toolUsed,
            latency_ms: Math.round(performance.now() - sentAt),
            first_token_ms:
              firstChunkAt === null ? null : Math.round(firstChunkAt - sentAt),
            response_length: full.length,
            has_quiz: !!mapped.quiz,
            has_flashcards: !!mapped.flashcards,
          });
          setThinkingHint(undefined);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId
                ? {
                    ...m,
                    content: full,
                    streaming: false,
                    meta: { ...m.meta, ...mapped, status: "completed" },
                  }
                : m,
            ),
          );
        },
        // The exam coach never asks clarifications or opens the quiz setup;
        // if an older backend did, drop the empty placeholder gracefully.
        onClarification: dropTurn,
        onQuizSetup: dropTurn,
        onError: (msg) => {
          const friendly = friendlyErrorMessage(msg);
          analytics.track(AnalyticsEvent.EXAM_PREP_RESPONSE_FAILED, {
            plan_id: planId,
            error_kind: errorKind(msg),
            phase: firstChunkAt === null ? "pre_stream" : "mid_stream",
          });
          retryHandlers.current.set(streamId, () => {
            retryHandlers.current.delete(streamId);
            setMessages((prev) =>
              prev.filter((m) => m.id !== streamId && m.id !== userMsgId),
            );
            send(text, opts);
          });
          setThinkingHint(undefined);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamId
                ? {
                    ...m,
                    content: "",
                    streaming: false,
                    meta: {
                      ...m.meta,
                      error: { message: friendly, prompt: display },
                    },
                  }
                : m,
            ),
          );
        },
      });
    },
    [dayId, mediaIds, planId, start, topicId],
  );

  const retry = useCallback(
    (messageId: string) => {
      const handler = retryHandlers.current.get(messageId);
      if (handler) {
        handler();
        return;
      }
      // No stored handler (e.g. a persisted failed turn): resend its prompt.
      const failed = messagesRef.current.find((m) => m.id === messageId);
      const prompt = failed?.meta?.error?.prompt;
      if (!prompt) return;
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      send(prompt);
    },
    [send],
  );

  return {
    messages,
    send,
    retry,
    streaming,
    thinkingHint,
    historyLoading: history.isLoading,
  };
}
