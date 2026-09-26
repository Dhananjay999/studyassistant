// Dispatch for the revision surfaces' action buttons. Revise always seeds a
// fresh chat with an auto-sent revision prompt; quiz/flashcards deep-link to
// the existing artifact when the revision item knows one, otherwise they too
// seed a chat that generates a new one on the topic.

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreateSession } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import type { ChatSeed } from "@/types";

export function revisionPrompt(topic: string): string {
  return `Give me a quick revision of ${topic}: summarize the key points, then check my understanding with a couple of questions.`;
}

export interface RevisionActionTarget {
  topic: string;
  quiz_id?: string | null;
  set_id?: string | null;
  space_id?: string | null;
}

export function useRevisionActions() {
  const navigate = useNavigate();
  const createSession = useCreateSession();

  const seedChat = async (seed: ChatSeed, spaceId?: string | null) => {
    try {
      const s = await createSession.mutateAsync({
        spaceId: spaceId ?? undefined,
      });
      analytics.track(AnalyticsEvent.CHAT_SESSION_CREATED, {
        chat_session_id: s.id,
        space_id: spaceId ?? null,
        trigger: "revision",
      });
      navigate(`/chat?sessionId=${s.id}`, { state: { seed } });
    } catch {
      toast.error("Couldn't start a chat");
    }
  };

  const clicked = (action: string, hasTarget: boolean) =>
    analytics.track(AnalyticsEvent.REVISION_ACTION_CLICKED, {
      action,
      has_existing_target: hasTarget,
    });

  return {
    pending: createSession.isPending,
    revise: (t: RevisionActionTarget) => {
      clicked("revise", false);
      return seedChat(
        { mode: "followup", content: "", autoSend: revisionPrompt(t.topic) },
        t.space_id,
      );
    },
    quiz: (t: RevisionActionTarget) => {
      clicked("quiz", !!t.quiz_id);
      return t.quiz_id
        ? navigate(`/quizzes?quizId=${t.quiz_id}`)
        : seedChat(
            { mode: "quiz", content: t.topic, title: t.topic },
            t.space_id,
          );
    },
    flashcards: (t: RevisionActionTarget) => {
      clicked("flashcards", !!t.set_id);
      return t.set_id
        ? navigate(`/flashcards?setId=${t.set_id}`)
        : seedChat(
            { mode: "flashcards", content: t.topic, title: t.topic },
            t.space_id,
          );
    },
  };
}
