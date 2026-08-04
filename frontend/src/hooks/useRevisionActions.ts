// Dispatch for the revision surfaces' action buttons. Revise always seeds a
// fresh chat with an auto-sent revision prompt; quiz/flashcards deep-link to
// the existing artifact when the revision item knows one, otherwise they too
// seed a chat that generates a new one on the topic.

import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useCreateSession } from "@/hooks/api";
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
      navigate(`/chat?sessionId=${s.id}`, { state: { seed } });
    } catch {
      toast.error("Couldn't start a chat");
    }
  };

  return {
    pending: createSession.isPending,
    revise: (t: RevisionActionTarget) =>
      seedChat(
        { mode: "followup", content: "", autoSend: revisionPrompt(t.topic) },
        t.space_id,
      ),
    quiz: (t: RevisionActionTarget) =>
      t.quiz_id
        ? navigate(`/quizzes?quizId=${t.quiz_id}`)
        : seedChat(
            { mode: "quiz", content: t.topic, title: t.topic },
            t.space_id,
          ),
    flashcards: (t: RevisionActionTarget) =>
      t.set_id
        ? navigate(`/flashcards?setId=${t.set_id}`)
        : seedChat(
            { mode: "flashcards", content: t.topic, title: t.topic },
            t.space_id,
          ),
  };
}
