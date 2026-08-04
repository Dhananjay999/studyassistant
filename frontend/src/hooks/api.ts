import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/lib/api";
import type {
  ConfidenceInput,
  CreateBookmarkInput,
  ExamConfig,
  LearningProfileInput,
  MediaItem,
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

export type { Session };
