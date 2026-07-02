import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/lib/api";
import type {
  CreateBookmarkInput,
  LearningProfileInput,
  MediaItem,
  Session,
  StudyRating,
} from "@/types";

export const qk = {
  sessions: ["sessions"] as const,
  media: ["media"] as const,
  // Nested under ["media"] so invalidating qk.media also invalidates per-item.
  mediaItem: (id: string) => ["media", id] as const,
  bookmarks: ["bookmarks"] as const,
  collections: ["collections"] as const,
  quizzes: ["quizzes"] as const,
  quizAttempts: (quizId: string) => ["quiz-attempts", quizId] as const,
  quizAttempt: (quizId: string, attemptId: string) =>
    ["quiz-attempts", quizId, attemptId] as const,
  flashcards: ["flashcards"] as const,
  flashcardSet: (id: string) => ["flashcards", id] as const,
  search: (q: string) => ["search", q] as const,
  learningProfile: ["learning-profile"] as const,
  analytics: ["analytics"] as const,
  config: ["config"] as const,
};

/* --------------------------------- config --------------------------------- */

export function useAppConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: api.getAppConfig,
    // Runtime limits rarely change; cache for the whole session.
    staleTime: Infinity,
  });
}

/* -------------------------------- sessions -------------------------------- */

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: api.listSessions });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      title?: string;
      mode?: "media" | "web_search";
      mediaIds?: string[];
    }) => api.createSession(v.title, v.mode, v.mediaIds),
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
    // Refresh the quizzes list + this quiz's attempt history.
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: qk.quizzes });
      qc.invalidateQueries({ queryKey: qk.quizAttempts(v.id) });
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

/* --------------------------------- search --------------------------------- */

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: qk.search(q),
    queryFn: () => api.searchAll(q),
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
