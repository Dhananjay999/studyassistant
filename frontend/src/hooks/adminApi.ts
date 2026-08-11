// TanStack Query hooks for the admin panel. Mirrors `hooks/api.ts` but for
// `lib/adminApi.ts`. Keys are namespaced under "admin" so they never collide
// with user-facing queries sharing the same QueryClient.

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { adminApi } from "@/lib/adminApi";
import type {
  AdminEditProfileInput,
  AdminResourcesParams,
  AdminUsersParams,
  GlobalResource,
  ResourceKey,
  UserResource,
} from "@/types/admin";

export const adminQk = {
  overview: ["admin", "overview"] as const,
  users: (params: AdminUsersParams) => ["admin", "users", params] as const,
  user: (id: string) => ["admin", "user", id] as const,
  session: (id: string) => ["admin", "session", id] as const,
  resource: (resource: ResourceKey, params: AdminResourcesParams) =>
    ["admin", "resource", resource, params] as const,
  search: (q: string) => ["admin", "search", q] as const,
  debugUsers: ["admin", "debug-users"] as const,
  timeline: (id: string) => ["admin", "timeline", id] as const,
  userSearch: (id: string, q: string) =>
    ["admin", "user-search", id, q] as const,
  quizDetail: (id: string) => ["admin", "quiz-detail", id] as const,
  flashcardDetail: (id: string) =>
    ["admin", "flashcard-detail", id] as const,
  mediaDetail: (id: string) => ["admin", "media-detail", id] as const,
  auditLog: (userId?: string) => ["admin", "audit-log", userId ?? ""] as const,
  featureFlags: ["admin", "feature-flags"] as const,
};

export function useAdminOverview() {
  return useQuery({ queryKey: adminQk.overview, queryFn: adminApi.overview });
}

export function useAdminUsers(params: AdminUsersParams) {
  return useQuery({
    queryKey: adminQk.users(params),
    queryFn: () => adminApi.listUsers(params),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: adminQk.user(id ?? ""),
    queryFn: () => adminApi.getUser(id as string),
    enabled: !!id,
  });
}

export function useAdminSession(id: string | null) {
  return useQuery({
    queryKey: adminQk.session(id ?? ""),
    queryFn: () => adminApi.getSession(id as string),
    enabled: !!id,
  });
}

export function useAdminResource(
  resource: ResourceKey,
  params: AdminResourcesParams,
) {
  return useQuery({
    queryKey: adminQk.resource(resource, params),
    queryFn: () => adminApi.listResource(resource, params),
    placeholderData: keepPreviousData,
  });
}

export function useAdminSearch(q: string) {
  return useQuery({
    queryKey: adminQk.search(q),
    queryFn: () => adminApi.search(q),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

/** Invalidate everything admin — used after destructive actions. */
function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["admin"] });
}

export function useAdminTimeline(userId: string | null) {
  return useQuery({
    queryKey: adminQk.timeline(userId ?? ""),
    queryFn: () => adminApi.timeline(userId!),
    enabled: !!userId,
  });
}

export function useAdminUserSearch(userId: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: adminQk.userSearch(userId, q),
    queryFn: () => adminApi.userSearch(userId, q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

export function useAdminQuizDetail(id: string | null) {
  return useQuery({
    queryKey: adminQk.quizDetail(id ?? ""),
    queryFn: () => adminApi.quizDetail(id!),
    enabled: !!id,
  });
}

export function useAdminFlashcardDetail(id: string | null) {
  return useQuery({
    queryKey: adminQk.flashcardDetail(id ?? ""),
    queryFn: () => adminApi.flashcardDetail(id!),
    enabled: !!id,
  });
}

export function useAdminMediaDetail(id: string | null) {
  return useQuery({
    queryKey: adminQk.mediaDetail(id ?? ""),
    queryFn: () => adminApi.mediaDetail(id!),
    enabled: !!id,
  });
}

export function useAdminAuditLog(userId?: string) {
  return useQuery({
    queryKey: adminQk.auditLog(userId),
    queryFn: () => adminApi.auditLog(userId),
  });
}

export function useEditProfile() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (v: { id: string; patch: AdminEditProfileInput }) =>
      adminApi.editProfile(v.id, v.patch),
    onSuccess: invalidate,
  });
}

export function useAdminDebugUsers() {
  return useQuery({
    queryKey: adminQk.debugUsers,
    queryFn: adminApi.listDebugUsers,
  });
}

export function useSetDebugUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      adminApi.setDebugUser(v.id, v.enabled),
    onSuccess: invalidate,
  });
}

export function useAdminFeatureFlags() {
  return useQuery({
    queryKey: adminQk.featureFlags,
    queryFn: adminApi.listFeatureFlags,
  });
}

export function useSetFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) =>
      adminApi.setFeatureFlag(v.key, v.enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminQk.featureFlags });
      // The user app reads flags from GET /config; refresh it so a toggle
      // shows up immediately in the same browser session.
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: invalidate,
  });
}

export function useResetLearningProfile() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => adminApi.resetLearningProfile(id),
    onSuccess: invalidate,
  });
}

export function useClearUserResource() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (v: { id: string; resource: UserResource }) =>
      adminApi.clearUserResource(v.id, v.resource),
    onSuccess: invalidate,
  });
}

export function useDeleteAll() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (resource: GlobalResource) => adminApi.deleteAll(resource),
    onSuccess: invalidate,
  });
}

export function useDeleteResourceItem() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (v: { resource: ResourceKey; id: string }) =>
      adminApi.deleteResourceItem(v.resource, v.id),
    onSuccess: invalidate,
  });
}
