// Isolated API client for the Super Admin panel.
//
// Deliberately separate from `lib/api.ts`: the admin session uses its OWN
// bearer token kept in sessionStorage (so it is ephemeral and never collides
// with the user's `aeva_*` localStorage tokens). Every call hits `/admin/*`
// and carries the admin token. A 401 raises `AdminAuthError`, which the auth
// context turns into an automatic logout.

import { API_BASE_URL } from "@/lib/api";
import type {
  AdminLoginResult,
  AdminOverview,
  AdminResourceList,
  AdminResourcesParams,
  AdminSearchResults,
  AdminSessionDetail,
  AdminUserDetail,
  AdminUserList,
  AdminUsersParams,
  GlobalResource,
  ResourceKey,
  UserResource,
} from "@/types/admin";

const TOKEN_KEY = "aeva_admin_token";
const TIMEOUT = 30000;

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage unavailable (private mode) — token stays in memory only */
  }
}

/** Thrown on any 401 from an admin endpoint (bad/expired token). */
export class AdminAuthError extends Error {}

// Registered by the auth context so a 401 anywhere logs the admin out.
let onAuthError: () => void = () => {};
export function setAdminAuthErrorHandler(fn: () => void): void {
  onAuthError = fn;
}

interface Envelope<T> {
  msg: string;
  data: T;
}

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const token = getAdminToken();
  try {
    const res = await fetch(`${API_BASE_URL}/admin${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });
    if (res.status === 401) {
      const err = await res.json().catch(() => ({}));
      onAuthError();
      throw new AdminAuthError(err.msg || "Admin session expired");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.msg || `Request failed (${res.status})`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function unwrap<T>(path: string, options?: RequestInit): Promise<T> {
  return adminRequest<Envelope<T>>(path, options).then((r) => r.data);
}

function usersQuery(params: AdminUsersParams): string {
  const sp = new URLSearchParams({
    q: params.q,
    page: String(params.page),
    page_size: String(params.page_size),
    sort: params.sort,
    order: params.order,
    status: params.status,
  });
  return sp.toString();
}

function resourceQuery(params: AdminResourcesParams): string {
  const sp = new URLSearchParams({
    q: params.q,
    user_id: params.user_id,
    page: String(params.page),
    page_size: String(params.page_size),
  });
  return sp.toString();
}

export const adminApi = {
  login: (username: string, password: string) =>
    unwrap<AdminLoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  verify: () => unwrap<{ username: string }>("/auth/verify"),
  overview: () => unwrap<AdminOverview>("/overview"),
  listUsers: (params: AdminUsersParams) =>
    unwrap<AdminUserList>(`/users?${usersQuery(params)}`),
  getUser: (id: string) => unwrap<AdminUserDetail>(`/users/${id}`),
  getSession: (id: string) => unwrap<AdminSessionDetail>(`/sessions/${id}`),
  deleteUser: (id: string) =>
    unwrap<{ user_id: string }>(`/users/${id}`, { method: "DELETE" }),
  resetLearningProfile: (id: string) =>
    unwrap<{ user_id: string }>(`/users/${id}/reset-learning-profile`, {
      method: "POST",
    }),
  clearUserResource: (id: string, resource: UserResource) =>
    unwrap<{ user_id: string; resource: string }>(
      `/users/${id}/resources/${resource}`,
      { method: "DELETE" },
    ),
  deleteAll: (resource: GlobalResource) =>
    unwrap<{ resource: string }>(`/resources/${resource}`, {
      method: "DELETE",
    }),
  listResource: (resource: ResourceKey, params: AdminResourcesParams) =>
    unwrap<AdminResourceList>(
      `/resources/${resource}?${resourceQuery(params)}`,
    ),
  deleteResourceItem: (resource: ResourceKey, id: string) =>
    unwrap<{ resource: string; id: string }>(
      `/resources/${resource}/${id}`,
      { method: "DELETE" },
    ),
  search: (q: string) =>
    unwrap<AdminSearchResults>(`/search?q=${encodeURIComponent(q)}`),
};
