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
