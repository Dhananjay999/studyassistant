// Everything a topic can do (status cycle, on-demand quiz / flashcards, open
// the lesson page), shared by TopicRow, TopicActionSheet and the topic page so
// all stay in step. One instance per row, so the generating spinners are per
// topic.

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useExamArtifacts } from "@/components/exam/useExamArtifacts";
import { nextStatus } from "@/components/exam/examFormat";
import {
  useGenerateExamTopicFlashcards,
  useGenerateExamTopicQuiz,
  useUpdateExamTopicStatus,
} from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import type { ExamPrepActionSource } from "@/lib/analytics/events";
import { errorKind } from "@/lib/errorMessage";
import type { ExamTopic, ExamTopicStatus } from "@/types";

export interface TopicActions {
  /** The status to render (optimistic while a change is in flight). */
  status: ExamTopicStatus;
  setStatus: (
    next: ExamTopicStatus,
    source?: ExamPrepActionSource,
    /** Extra event props, e.g. the study timer reading when completing. */
    extra?: { study_seconds?: number },
  ) => void;
  cycleStatus: (source?: ExamPrepActionSource) => void;
  statusBusy: boolean;
  quiz: (source?: ExamPrepActionSource) => Promise<void>;
  quizBusy: boolean;
  flashcards: (source?: ExamPrepActionSource) => Promise<void>;
  flashcardsBusy: boolean;
  /** Open the topic page (Aeva's lesson, practice and the doubt box). */
  open: () => void;
}

export function useTopicActions(
  topic: ExamTopic,
  // Kept for callers; the lesson page derives the exam name itself.
  _examName: string,
  defaultSource: ExamPrepActionSource,
): TopicActions {
  const navigate = useNavigate();
  const artifacts = useExamArtifacts();
  const updateStatus = useUpdateExamTopicStatus();
  const genQuiz = useGenerateExamTopicQuiz();
  const genFlashcards = useGenerateExamTopicFlashcards();
  const [optimistic, setOptimistic] = useState<ExamTopicStatus | null>(null);

  const status = optimistic ?? topic.status;

  const setStatus = useCallback(
    (
      next: ExamTopicStatus,
      source: ExamPrepActionSource = defaultSource,
      extra?: { study_seconds?: number },
    ) => {
      const from = optimistic ?? topic.status;
      if (next === from) return;
      analytics.track(AnalyticsEvent.EXAM_PREP_TOPIC_STATUS_CHANGED, {
        plan_id: topic.plan_id,
        topic_id: topic.id,
        from,
        to: next,
        source,
        ...(extra?.study_seconds !== undefined
          ? { study_seconds: extra.study_seconds }
          : {}),
      });
      setOptimistic(next);
      updateStatus.mutate(
        { topicId: topic.id, status: next },
        {
          onError: () => toast.error("Couldn't update the topic. Try again."),
          onSettled: () => setOptimistic(null),
        },
      );
    },
    [defaultSource, optimistic, topic.id, topic.plan_id, topic.status, updateStatus],
  );

  const cycleStatus = useCallback(
    (source?: ExamPrepActionSource) => setStatus(nextStatus(status), source),
    [setStatus, status],
  );

  const quiz = useCallback(
    async (source: ExamPrepActionSource = defaultSource) => {
      if (topic.quiz_id) {
        await artifacts.openQuizById(topic.quiz_id);
        return;
      }
      analytics.track(AnalyticsEvent.EXAM_PREP_QUIZ_REQUESTED, {
        plan_id: topic.plan_id,
        topic_id: topic.id,
        source,
      });
      const t0 = performance.now();
      try {
        const result = await genQuiz.mutateAsync({ topicId: topic.id });
        analytics.track(AnalyticsEvent.EXAM_PREP_QUIZ_CREATED, {
          plan_id: topic.plan_id,
          topic_id: topic.id,
          quiz_id: result.quiz_id,
          latency_ms: Math.round(performance.now() - t0),
        });
        await artifacts.openQuizById(result.quiz_id);
      } catch (err) {
        analytics.track(AnalyticsEvent.EXAM_PREP_GENERATION_FAILED, {
          plan_id: topic.plan_id,
          topic_id: topic.id,
          kind: "quiz",
          error_kind: errorKind(err),
        });
        toast.error("Couldn't create the quiz. Please try again.");
      }
    },
    [artifacts, defaultSource, genQuiz, topic.id, topic.plan_id, topic.quiz_id],
  );

  const flashcards = useCallback(
    async (source: ExamPrepActionSource = defaultSource) => {
      if (topic.flashcard_set_id) {
        artifacts.openFlashcards(topic.flashcard_set_id);
        return;
      }
      analytics.track(AnalyticsEvent.EXAM_PREP_FLASHCARDS_REQUESTED, {
        plan_id: topic.plan_id,
        topic_id: topic.id,
        source,
      });
      const t0 = performance.now();
      try {
        const result = await genFlashcards.mutateAsync({ topicId: topic.id });
        analytics.track(AnalyticsEvent.EXAM_PREP_FLASHCARDS_CREATED, {
          plan_id: topic.plan_id,
          topic_id: topic.id,
          set_id: result.set_id,
          latency_ms: Math.round(performance.now() - t0),
        });
        artifacts.openFlashcards(result.set_id);
      } catch (err) {
        analytics.track(AnalyticsEvent.EXAM_PREP_GENERATION_FAILED, {
          plan_id: topic.plan_id,
          topic_id: topic.id,
          kind: "flashcards",
          error_kind: errorKind(err),
        });
        toast.error("Couldn't create the flashcards. Please try again.");
      }
    },
    [
      artifacts,
      defaultSource,
      genFlashcards,
      topic.flashcard_set_id,
      topic.id,
      topic.plan_id,
    ],
  );

  const open = useCallback(() => {
    navigate(`/exam/topic/${topic.id}`);
  }, [navigate, topic.id]);

  return {
    status,
    setStatus,
    cycleStatus,
    statusBusy: updateStatus.isPending,
    quiz,
    // `loadingQuizId` is null when idle; a topic without a quiz must not
    // match it (null === null), or every row would show "Creating…".
    quizBusy:
      genQuiz.isPending ||
      (topic.quiz_id !== null && artifacts.loadingQuizId === topic.quiz_id),
    flashcards,
    flashcardsBusy: genFlashcards.isPending,
    open,
  };
}
