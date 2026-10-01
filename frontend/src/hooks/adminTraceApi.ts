// TanStack Query hooks for AI execution traces and the prompt catalog.
// A separate module so `hooks/adminApi.ts` stays untouched. Keys share the
// "admin" namespace, so the panel's "invalidate everything admin" after a
// destructive action covers them too.

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AdminForbiddenError, adminTraceApi } from "@/lib/adminTraceApi";
import type { AdminTracesParams } from "@/types/adminTrace";

export const adminTraceQk = {
  traces: (params: AdminTracesParams) => ["admin", "traces", params] as const,
  trace: (id: string) => ["admin", "trace", id] as const,
  sessionTraces: (id: string) => ["admin", "session-traces", id] as const,
  promptCatalog: (days: number) => ["admin", "prompt-catalog", days] as const,
  promptVersion: (name: string, hash: string) =>
    ["admin", "prompt-version", name, hash] as const,
};

// A missing permission does not fix itself: show that state at once
// instead of asking again. Anything else keeps the app's single retry.
const retryUnlessForbidden = (failures: number, error: unknown) =>
  !(error instanceof AdminForbiddenError) && failures < 1;

export function useAdminTraces(params: AdminTracesParams) {
  return useQuery({
    queryKey: adminTraceQk.traces(params),
    queryFn: () => adminTraceApi.listTraces(params),
    placeholderData: keepPreviousData,
    retry: retryUnlessForbidden,
  });
}

export function useAdminTrace(id: string | null) {
  return useQuery({
    queryKey: adminTraceQk.trace(id ?? ""),
    queryFn: () => adminTraceApi.getTrace(id as string),
    enabled: !!id,
    retry: retryUnlessForbidden,
  });
}

/** Traces of one session (newest first), to link messages to their trace. */
export function useAdminSessionTraces(sessionId: string | null) {
  return useQuery({
    queryKey: adminTraceQk.sessionTraces(sessionId ?? ""),
    queryFn: () => adminTraceApi.sessionTraces(sessionId as string),
    enabled: !!sessionId,
    // Passive lookup behind the conversation viewer: never worth a retry.
    retry: false,
  });
}

export function useAdminPromptCatalog(days = 7) {
  return useQuery({
    queryKey: adminTraceQk.promptCatalog(days),
    queryFn: () => adminTraceApi.promptCatalog(days),
    // Changing the usage window only changes the counts: keep showing the
    // catalog already on screen while the new one loads.
    placeholderData: keepPreviousData,
    retry: retryUnlessForbidden,
  });
}

/** Stored text of one prompt version (fetched when a diff is opened). */
export function useAdminPromptVersion(
  name: string | null,
  hash: string | null,
) {
  return useQuery({
    queryKey: adminTraceQk.promptVersion(name ?? "", hash ?? ""),
    queryFn: () => adminTraceApi.promptVersion(name as string, hash as string),
    enabled: !!name && !!hash,
    staleTime: Infinity,
  });
}

export function useAdminPurgeTraces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => adminTraceApi.purgeTraces(days),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}
