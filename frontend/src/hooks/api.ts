import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { CreateBookmarkInput, Session } from "@/types";

export const qk = {
  sessions: ["sessions"] as const,
  media: ["media"] as const,
  bookmarks: ["bookmarks"] as const,
  collections: ["collections"] as const,
  quizzes: ["quizzes"] as const,
  search: (q: string) => ["search", q] as const,
};

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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
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

/** All of the user's media (newest first), independent of session. */
export function useMedia() {
  return useQuery({ queryKey: qk.media, queryFn: () => api.listMedia() });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMedia(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.media }),
  });
}

/* ---------------------------------- quiz ---------------------------------- */

export function useSubmitQuiz() {
  return useMutation({
    mutationFn: (v: { id: string; answers: Record<string, string[]> }) =>
      api.submitQuiz(v.id, v.answers),
  });
}

export function useQuizzes() {
  return useQuery({ queryKey: qk.quizzes, queryFn: api.listQuizzes });
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

export type { Session };
