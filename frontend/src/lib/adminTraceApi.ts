// Admin API calls for AI execution traces and the prompt catalog.
//
// A separate module so `lib/adminApi.ts` stays untouched. It uses the same
// admin bearer token and answers the same way, with one addition: a 403
// (signed in, but without the permission to view traces) is raised as
// `AdminForbiddenError` so pages can show a "no permission" state.

import { API_BASE_URL } from "@/lib/api";
import { AdminAuthError, adminApi, getAdminToken } from "@/lib/adminApi";
import type {
  AdminPromptCatalog,
  AdminPromptVersion,
  AdminSessionTraces,
  AdminTraceDetail,
  AdminTraceList,
  AdminTracesParams,
} from "@/types/adminTrace";

const TIMEOUT = 30000;

/** Thrown on a 403: signed in, but this admin lacks the permission. */
export class AdminForbiddenError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    if (res.ok) {
      const body = (await res.json()) as { data: T };
      return body.data;
    }
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // The session expired. The shared client owns the logout: one call
      // through it reaches the same 401 and signs the admin out.
      await adminApi.verify().catch(() => undefined);
      throw new AdminAuthError(err.msg || "Admin session expired");
    }
    if (res.status === 403) {
      throw new AdminForbiddenError(err.msg || "Request failed (403)");
    }
    throw new Error(err.msg || `Request failed (${res.status})`);
  } finally {
    clearTimeout(timer);
  }
}

function tracesQuery(params: AdminTracesParams): string {
  const sp = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.page_size),
  });
  // Only send filters that are set, so the backend sees clean defaults.
  const filters = {
    q: params.q,
    user_id: params.user_id,
    session_id: params.session_id,
    status: params.status,
    tool: params.tool,
    prompt: params.prompt,
    plan_source: params.plan_source,
  };
  for (const [key, value] of Object.entries(filters)) {
    if (value) sp.set(key, value);
  }
  return sp.toString();
}

export const adminTraceApi = {
  listTraces: (params: AdminTracesParams) =>
    request<AdminTraceList>(`/traces?${tracesQuery(params)}`),
  getTrace: (id: string) =>
    request<AdminTraceDetail>(`/traces/${encodeURIComponent(id)}`),
  sessionTraces: (sessionId: string) =>
    request<AdminSessionTraces>(
      `/sessions/${encodeURIComponent(sessionId)}/traces`,
    ),
  purgeTraces: (days: number) =>
    request<{ removed: number; days: number }>("/traces/purge", {
      method: "POST",
      body: JSON.stringify({ days }),
    }),
  promptCatalog: (days = 7) =>
    request<AdminPromptCatalog>(`/prompts?days=${days}`),
  promptVersion: (name: string, hash: string) =>
    request<AdminPromptVersion>(
      `/prompts/${encodeURIComponent(name)}/versions/${encodeURIComponent(hash)}`,
    ),
};
