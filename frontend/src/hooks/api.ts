import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/lib/api";
import { hasExamPlan } from "@/types";
import type {
  ConfidenceInput,
  CreateBookmarkInput,
  CreateExamPlanRequest,
  ExamConfig,
  ExamDashboard,
  ExamDashboardResponse,
  ExamTopic,
  ExamTopicFlashcardsRequest,
  ExamTopicQuizRequest,
  ExamTopicStatus,
  FlashcardGenerateRequest,
  LearningProfileInput,
  MediaItem,
  QuizGenerateRequest,
  Session,
  StudyRating,
} from "@/types";

export const qk = {
  sessions: ["sessions"] as const,
  spaces: ["spaces"] as const,
  // Nested under ["spaces"] so invalidating qk.spaces refreshes overviews too.
  spaceOverview: (id: string) => ["spaces", id, "overview"] as const,
  spaceStats: (id: string) => ["spaces", id, "stats"] as const,
  notes: (spaceId?: string) =>
    spaceId ? (["notes", { spaceId }] as const) : (["notes"] as const),
  note: (id: string) => ["notes", "detail", id] as const,
  media: ["media"] as const,
  // Nested under ["media"] so invalidating qk.media also invalidates per-item.
  mediaItem: (id: string) => ["media", id] as const,
  bookmarks: ["bookmarks"] as const,
  collections: ["collections"] as const,
  quizzes: ["quizzes"] as const,
  examPatterns: ["exam-patterns"] as const,
  quizAttempts: (quizId: string) => ["quiz-attempts", quizId] as const,
  quizAttempt: (quizId: string, attemptId: string) =>
    ["quiz-attempts", quizId, attemptId] as const,
  flashcards: ["flashcards"] as const,
  flashcardSet: (id: string) => ["flashcards", id] as const,
  search: (q: string, spaceId?: string) =>
    ["search", q, spaceId ?? null] as const,
  learningProfile: ["learning-profile"] as const,
  analytics: ["analytics"] as const,
  // Nested under ["revision"] so one invalidation refreshes dashboard + home.
  revision: ["revision"] as const,
  revisionDashboard: ["revision", "dashboard"] as const,
  revisionHome: ["revision", "home"] as const,
  config: ["config"] as const,
  // Exam Prep: nested under ["exam-prep"] so one invalidation after a topic
  // status change or generation refreshes the dashboard, the day and the chat.
  examPrep: ["exam-prep"] as const,
  examPlan: ["exam-prep", "plan"] as const,
  examDay: (planId: string, dayId: string) =>
    ["exam-prep", "day", planId, dayId] as const,
  examMessages: (planId: string, topicId?: string) =>
    ["exam-prep", "messages", planId, topicId ?? "all"] as const,
  examTopicLesson: (topicId: string) =>
    ["exam-prep", "lesson", topicId] as const,
};

/** Mutation keys for direct creation, so a library page can render in-flight
 * generations (via `useMutationState`) even after its panel has closed. */
export const mk = {
  generateQuiz: ["generate-quiz"] as const,
  generateFlashcards: ["generate-flashcards"] as const,
};

/* --------------------------------- config --------------------------------- */

export function useAppConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: api.getAppConfig,
    // Feature flags ride on /config: a modest stale window lets admin
    // toggles propagate on navigation/focus without a reload.
    staleTime: 5 * 60_000,
  });
}

/* -------------------------------- sessions -------------------------------- */

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: api.listSessions });
}

/* ------------------------------ Study Spaces ------------------------------ */

export function useSpaces() {
  return useQuery({ queryKey: qk.spaces, queryFn: api.listSpaces });
}

export function useSpaceOverview(id: string | undefined) {
  return useQuery({
    queryKey: qk.spaceOverview(id ?? ""),
    queryFn: () => api.getSpaceOverview(id!),
    enabled: !!id,
  });
}

export function useSpaceStats(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.spaceStats(id ?? ""),
    queryFn: () => api.getSpaceStats(id!),
    enabled: !!id && enabled,
    // Stats aggregate several tables — don't refetch on every focus.
    staleTime: 60_000,
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createSpace,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.spaces }),
  });
}

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: api.SpaceStyleInput & { name?: string };
    }) => api.updateSpace(v.id, v.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.spaces }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; mode?: "move" | "purge" }) =>
      api.deleteSpace(v.id, v.mode),
    // Contents moved to General (or were purged) — every scoped list may
    // have changed.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useConvertToSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.convertSessionToSpace,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.spaces });
      qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

/* ---------------------------------- notes --------------------------------- */

export function useNotes(spaceId?: string) {
  return useQuery({
    queryKey: qk.notes(spaceId),
    queryFn: () => api.listNotes(spaceId),
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: qk.note(id ?? ""),
    queryFn: () => api.getNote(id!),
    enabled: !!id,
  });
}

/** Invalidate every notes-derived surface (lists, space overviews). */
function invalidateNotes(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["notes"] });
  qc.invalidateQueries({ queryKey: qk.spaces });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createNote,
    onSuccess: () => invalidateNotes(qc),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      patch: { title?: string; content_md?: string; space_id?: string | null };
    }) => api.updateNote(v.id, v.patch),
    onSuccess: (note) => {
      qc.setQueryData(qk.note(note.id), note);
      invalidateNotes(qc);
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => invalidateNotes(qc),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      title?: string;
      mode?: "media" | "web_search";
      mediaIds?: string[];
      spaceId?: string;
    }) => api.createSession(v.title, v.mode, v.mediaIds, v.spaceId),
    // The POST already returns the full session row, so optimistically prepend
    // it to the cached list instead of firing a second GET /sessions. The
    // sidebar updates instantly and no redundant network request is made.
    onSuccess: (created) => {
      qc.setQueryData<Session[]>(qk.sessions, (cur) =>
        cur ? [created, ...cur.filter((s) => s.id !== created.id)] : [created],
      );
    },
  });
}

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      api.renameSession(v.id, v.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

/* ---------------------------------- media --------------------------------- */

/**
 * All of the user's media (newest first), independent of session. The list is
 * kept fresh by optimistic writes (upload via SSE, delete below), so it rarely
 * needs re-fetching — a long staleTime avoids redundant GET /media calls.
 */
export function useMedia() {
  return useQuery({
    queryKey: qk.media,
    queryFn: () => api.listMedia(),
    staleTime: 5 * 60_000,
  });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMedia(id),
    // Optimistically drop the row; roll back if the request fails. No refetch.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.media });
      const prev = qc.getQueryData<MediaItem[]>(qk.media);
      qc.setQueryData<MediaItem[]>(qk.media, (cur) =>
        cur?.filter((m) => m.id !== id),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.media, ctx.prev);
    },
  });
}

/* ---------------------------------- quiz ---------------------------------- */

export function useSubmitQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      answers: Record<string, string[]>;
      timeTakenSeconds?: number;
    }) => api.submitQuiz(v.id, v.answers, v.timeTakenSeconds),
    // Refresh the quizzes list + this quiz's attempt history. The submit
    // also moved the topic's revision schedule on the backend.
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: qk.quizzes });
      qc.invalidateQueries({ queryKey: qk.quizAttempts(v.id) });
      qc.invalidateQueries({ queryKey: qk.revision });
    },
  });
}

export function useAnalyzeQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; attemptId: string }) =>
      api.analyzeQuiz(v.id, v.attemptId),
    // Flip the attempt's "View AI Analysis" state across list + detail.
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: qk.quizAttempts(v.id) });
      qc.invalidateQueries({ queryKey: qk.quizAttempt(v.id, v.attemptId) });
    },
  });
}

/** Create a quiz from the Quizzes page. Invalidation lives here (not in a
 * `mutate` callback) so the library refreshes even if the page unmounted. */
export function useGenerateQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: mk.generateQuiz,
    mutationFn: (body: QuizGenerateRequest) => api.generateQuiz(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.quizzes });
      qc.invalidateQueries({ queryKey: qk.spaces });
    },
  });
}

export function useQuizzes() {
  return useQuery({ queryKey: qk.quizzes, queryFn: api.listQuizzes });
}

export function useExamPatterns() {
  return useQuery({
    queryKey: qk.examPatterns,
    queryFn: api.listExamPatterns,
    // Presets are backend constants; cache for the whole session.
    staleTime: Infinity,
  });
}

export function useUpdateExamConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; examConfig: ExamConfig }) =>
      api.updateQuizExamConfig(v.id, v.examConfig),
    // The quiz library shows the pattern/timer, so refresh it after an edit.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quizzes }),
  });
}

export function useQuizAttempts(quizId: string, enabled = true) {
  return useQuery({
    queryKey: qk.quizAttempts(quizId),
    queryFn: () => api.listQuizAttempts(quizId),
    enabled: enabled && Boolean(quizId),
  });
}

export function useQuizAttempt(
  quizId: string,
  attemptId: string | null,
) {
  return useQuery({
    queryKey: qk.quizAttempt(quizId, attemptId ?? ""),
    queryFn: () => api.getQuizAttempt(quizId, attemptId as string),
    enabled: Boolean(quizId) && Boolean(attemptId),
  });
}

/* ------------------------------- flashcards ------------------------------- */

export function useFlashcardSets() {
  return useQuery({
    queryKey: qk.flashcards,
    queryFn: api.listFlashcardSets,
  });
}

/** Create a flashcard set from the Flashcards page (see useGenerateQuiz). */
export function useGenerateFlashcards() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: mk.generateFlashcards,
    mutationFn: (body: FlashcardGenerateRequest) =>
      api.generateFlashcards(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.flashcards });
      qc.invalidateQueries({ queryKey: qk.spaces });
    },
  });
}

export function useFlashcardSet(id: string | null) {
  return useQuery({
    queryKey: qk.flashcardSet(id ?? ""),
    queryFn: () => api.getFlashcardSet(id as string),
    enabled: Boolean(id),
  });
}

export function useRecordStudy() {
  return useMutation({
    mutationFn: (v: {
      setId: string;
      flashcardId: string;
      rating: StudyRating;
    }) => api.recordFlashcardStudy(v.setId, v.flashcardId, v.rating),
  });
}

export function useRecordStudyBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      setId: string;
      ratings: { flashcard_id: string; rating: StudyRating }[];
    }) => api.recordFlashcardStudyBatch(v.setId, v.ratings),
    // The batch save also moved the topic's revision schedule.
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.revision }),
  });
}

/* --------------------------------- search --------------------------------- */

export function useSearch(query: string, spaceId?: string) {
  const q = query.trim();
  return useQuery({
    queryKey: qk.search(q, spaceId),
    queryFn: () => api.searchAll(q, spaceId),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

/* -------------------------------- bookmarks ------------------------------- */

export function useBookmarks() {
  return useQuery({ queryKey: qk.bookmarks, queryFn: api.listBookmarks });
}

export function useCollections() {
  return useQuery({ queryKey: qk.collections, queryFn: api.listCollections });
}

export function useCreateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookmarkInput) => api.createBookmark(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bookmarks }),
  });
}

export function useDeleteBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBookmark(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bookmarks }),
  });
}

export function useUpdateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: string;
      collection_id?: string | null;
      title?: string;
    }) => api.updateBookmark(v.id, { collection_id: v.collection_id, title: v.title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bookmarks }),
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createCollection(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collections }),
  });
}

export function useRenameCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api.renameCollection(v.id, v.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.collections }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCollection(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collections });
      qc.invalidateQueries({ queryKey: qk.bookmarks });
    },
  });
}

/* ---------------------------- learning profile ---------------------------- */

export function useLearningProfile() {
  return useQuery({
    queryKey: qk.learningProfile,
    queryFn: api.getLearningProfile,
    // The profile rarely changes; fetch it once and reuse from cache for the
    // whole session. It is refreshed only when the user saves/skips (which
    // invalidate this key) or explicitly refetches — never on every new chat.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSaveLearningProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LearningProfileInput) =>
      api.saveLearningProfile(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.learningProfile }),
  });
}

/* -------------------------------- analytics ------------------------------- */

export function useAnalytics() {
  return useQuery({
    queryKey: qk.analytics,
    queryFn: api.getAnalytics,
    // Aggregates shift slowly; a short stale window avoids refetching on every
    // navigation back to the dashboard.
    staleTime: 2 * 60_000,
  });
}

/* -------------------------------- revision -------------------------------- */

export function useRevisionDashboard() {
  return useQuery({
    queryKey: qk.revisionDashboard,
    queryFn: api.getRevisionDashboard,
    // Due buckets move on study activity (invalidated by the mutations
    // below), not on their own; a minute of staleness is fine.
    staleTime: 60_000,
  });
}

export function useRevisionHome(enabled = true) {
  return useQuery({
    queryKey: qk.revisionHome,
    queryFn: api.getRevisionHome,
    enabled,
    // Greeting/recommendations shift slowly; matches useAnalytics' window.
    staleTime: 2 * 60_000,
  });
}

export function useSubmitConfidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfidenceInput) =>
      api.postRevisionConfidence(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.revision });
      qc.invalidateQueries({ queryKey: qk.analytics });
    },
  });
}

/* ------------------------ learning profile mutations ---------------------- */

export function useSkipPersonalization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.skipPersonalization(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.learningProfile }),
  });
}

/* -------------------------------- Exam Prep ------------------------------- */
// Behind the `exam_prep` feature flag (callers pass `enabled`).

export function useExamDashboard(enabled = true) {
  return useQuery({
    queryKey: qk.examPlan,
    queryFn: api.getExamDashboard,
    enabled,
    // Days remaining / "today" depend on the date; refresh on focus is enough.
    staleTime: 60_000,
  });
}

export function useCreateExamPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExamPlanRequest) => api.createExamPlan(body),
    onSuccess: (dashboard) => {
      // The POST returns the full dashboard: seed the cache, no second GET.
      qc.setQueryData<ExamDashboardResponse>(qk.examPlan, dashboard);
      qc.invalidateQueries({ queryKey: qk.examPrep, refetchType: "none" });
    },
  });
}

export function useArchiveExamPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => api.archiveExamPlan(planId),
    onSuccess: () => {
      qc.setQueryData<ExamDashboardResponse>(qk.examPlan, { plan: null });
      qc.invalidateQueries({ queryKey: qk.examPrep });
    },
  });
}

/** One day's detail. The first open generates the detailed plan server-side
 * (slow), so results are kept fresh for a long time once loaded. */
export function useExamDay(
  planId: string | undefined,
  dayId: string | undefined,
) {
  return useQuery({
    queryKey: qk.examDay(planId ?? "", dayId ?? ""),
    queryFn: () => api.getExamDay(planId!, dayId!),
    enabled: !!planId && !!dayId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Patch every cached copy of a topic (dashboard days + the day detail).
 * Exported for the topic page: the lesson stream's done frame returns the
 * updated topic (a fresh topic becomes in-progress on its first lesson). */
export function patchExamTopic(
  qc: ReturnType<typeof useQueryClient>,
  topic: ExamTopic,
) {
  qc.setQueryData<ExamDashboardResponse>(qk.examPlan, (cur) => {
    if (!hasExamPlan(cur)) return cur;
    const days = cur.days.map((d) => ({
      ...d,
      subjects: d.subjects.map((s) => ({
        ...s,
        topics: s.topics.map((t) => (t.id === topic.id ? topic : t)),
      })),
    }));
    const pick = (id: string) => days.find((d) => d.id === id);
    const recount = (d: ExamDashboard["days"][number]) => {
      const all = d.subjects.flatMap((s) => s.topics);
      return {
        ...d,
        completed_count: all.filter((t) => t.status === "completed").length,
        in_progress_count: all.filter((t) => t.status === "in_progress")
          .length,
      };
    };
    const recounted = days.map(recount);
    const allTopics = recounted.flatMap((d) =>
      d.subjects.flatMap((s) => s.topics),
    );
    const completed = allTopics.filter((t) => t.status === "completed").length;
    const inProgress = allTopics.filter(
      (t) => t.status === "in_progress",
    ).length;
    const total = allTopics.length;
    return {
      ...cur,
      days: recounted,
      today: cur.today
        ? (recounted.find((d) => d.id === cur.today!.id) ?? cur.today)
        : null,
      upcoming: cur.upcoming.map((u) => pick(u.id) ?? u).map(recount),
      progress: {
        total_topics: total,
        completed,
        in_progress: inProgress,
        not_started: Math.max(0, total - completed - inProgress),
        percent: total ? Math.round((completed / total) * 100) : 0,
      },
      subjects: cur.subjects.map((s) => {
        const mine = allTopics.filter((t) => t.subject === s.subject);
        return {
          ...s,
          total: mine.length,
          completed: mine.filter((t) => t.status === "completed").length,
          in_progress: mine.filter((t) => t.status === "in_progress").length,
        };
      }),
    };
  });
  qc.setQueryData<ExamDayDetailCache>(
    qk.examDay(topic.plan_id, topic.day_id),
    (cur) =>
      cur
        ? {
            ...cur,
            subjects: cur.subjects.map((s) => ({
              ...s,
              topics: s.topics.map((t) => (t.id === topic.id ? topic : t)),
            })),
          }
        : cur,
  );
}

type ExamDayDetailCache = Awaited<ReturnType<typeof api.getExamDay>>;

export function useUpdateExamTopicStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { topicId: string; status: ExamTopicStatus }) =>
      api.updateExamTopicStatus(v.topicId, v.status),
    onSuccess: (topic) => patchExamTopic(qc, topic),
    onError: () => {
      qc.invalidateQueries({ queryKey: qk.examPrep });
    },
  });
}

export function useGenerateExamTopicQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { topicId: string; body?: ExamTopicQuizRequest }) =>
      api.generateExamTopicQuiz(v.topicId, v.body),
    onSuccess: () => {
      // The topic row now carries quiz_id (and may be in_progress).
      qc.invalidateQueries({ queryKey: qk.examPrep });
      qc.invalidateQueries({ queryKey: qk.quizzes });
    },
  });
}

export function useGenerateExamTopicFlashcards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      topicId: string;
      body?: ExamTopicFlashcardsRequest;
    }) => api.generateExamTopicFlashcards(v.topicId, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.examPrep });
      qc.invalidateQueries({ queryKey: qk.flashcards });
    },
  });
}

export function useExamMessages(
  planId: string | undefined,
  topicId?: string,
) {
  return useQuery({
    queryKey: qk.examMessages(planId ?? "", topicId),
    queryFn: () => api.getExamMessages(planId!, 60, topicId),
    enabled: !!planId,
    staleTime: Infinity,
  });
}

/** A topic with its lesson. `lesson_md` is null until the lesson stream has
 * run once; the topic page then invalidates this key. */
export function useExamTopicLesson(topicId: string | undefined) {
  return useQuery({
    queryKey: qk.examTopicLesson(topicId ?? ""),
    queryFn: () => api.getExamTopicLesson(topicId!),
    enabled: !!topicId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export type { Session };
