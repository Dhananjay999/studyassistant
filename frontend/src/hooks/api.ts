import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { Session } from "@/types";

export const qk = {
  sessions: ["sessions"] as const,
  media: ["media"] as const,
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

export type { Session };
