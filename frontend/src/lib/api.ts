// Typed API client for the Aeva Flask backend.
// All endpoints return the { msg, data } envelope; helpers unwrap `data`.

import type {
  APIEnvelope,
  AssistantRequest,
  Bookmark,
  BookmarkCollection,
  CreateBookmarkInput,
  LearningProfile,
  LearningProfileInput,
  MediaItem,
  FlashcardAnalytics,
  FlashcardListItem,
  FlashcardSetDetail,
  Message,
  QuizAnalysis,
  QuizAttemptDetail,
  QuizAttemptSummary,
  QuizContent,
  QuizListItem,
  QuizSubmitResult,
  SearchResults,
  Session,
  StudyRating,
  User,
} from "@/types";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 30000;

export const ENDPOINTS = {
  AUTH_ME: "/auth/me",
  AUTH_REFRESH: "/auth/refresh",
  AUTH_LOGIN_GOOGLE: "/auth/login/google",
  SESSIONS: "/sessions/",
  SESSION: (id: string) => `/sessions/${id}`,
  SESSION_MESSAGES: (id: string) => `/sessions/${id}/messages`,
  MEDIA: "/media/",
  MEDIA_ITEM: (id: string) => `/media/${id}`,
  ASSISTANT_STREAM: "/assistant/stream",
  QUIZZES: "/quiz/",
  QUIZ: (id: string) => `/quiz/${id}`,
  QUIZ_SUBMIT: (id: string) => `/quiz/${id}/submit`,
  QUIZ_ANALYZE: (id: string) => `/quiz/${id}/analyze`,
  QUIZ_ATTEMPTS: (id: string) => `/quiz/${id}/attempts`,
  QUIZ_ATTEMPT: (id: string, attemptId: string) =>
    `/quiz/${id}/attempts/${attemptId}`,
  BOOKMARKS: "/bookmarks/",
  BOOKMARK: (id: string) => `/bookmarks/${id}`,
  COLLECTIONS: "/bookmarks/collections",
  COLLECTION: (id: string) => `/bookmarks/collections/${id}`,
  SEARCH: "/search/",
  FLASHCARDS: "/flashcards/",
  FLASHCARD: (id: string) => `/flashcards/${id}`,
  FLASHCARD_STUDY: (id: string) => `/flashcards/${id}/study`,
  LEARNING_PROFILE: "/learning-profile/",
  LEARNING_PROFILE_SKIP: "/learning-profile/skip",
} as const;

type TokenGetter = () => string | null;

let getToken: TokenGetter = () => null;
export function setTokenGetter(getter: TokenGetter) {
  getToken = getter;
}
export function getAuthToken(): string | null {
  return getToken();
}

function authHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
      signal: controller.signal,
    });
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
  return request<APIEnvelope<T>>(path, options).then((r) => r.data);
}

/* ---------------------------------- auth ---------------------------------- */

export const getMe = () => unwrap<User>(ENDPOINTS.AUTH_ME);

export async function refreshSession(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(`${API_BASE_URL}${ENDPOINTS.AUTH_REFRESH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error("Refresh failed");
  const json = await res.json();
  return json.data;
}

/* -------------------------------- sessions -------------------------------- */

export const listSessions = () => unwrap<Session[]>(ENDPOINTS.SESSIONS);

export const createSession = (
  title = "New chat",
  mode: "media" | "web_search" = "media",
  mediaIds: string[] = [],
) =>
  unwrap<Session>(ENDPOINTS.SESSIONS, {
    method: "POST",
    body: JSON.stringify({ title, mode, media_ids: mediaIds }),
  });

export const renameSession = (id: string, title: string) =>
  unwrap<Session>(ENDPOINTS.SESSION(id), {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

export const deleteSession = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.SESSION(id), { method: "DELETE" });

/** Loads a session's messages and normalizes backend metadata for the UI. */
export async function getMessages(id: string): Promise<Message[]> {
  const rows = await unwrap<
    Array<{
      id: string;
      role: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>
  >(ENDPOINTS.SESSION_MESSAGES(id));

  return rows.map((m) => {
    const md = m.metadata ?? {};
    const inner = (md.content ?? {}) as Record<string, unknown>;
    const toolUsed = md.tool_used as Message["meta"]["tool_used"];
    return {
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      createdAt: new Date(m.created_at),
      meta: {
        // sources live under metadata.content on the backend, not top-level.
        sources: (inner.sources as Message["meta"]["sources"]) || [],
        tool_used: toolUsed,
        status: md.status as Message["meta"]["status"],
        run_id: md.run_id as string | undefined,
        clarification: md.clarification as Message["meta"]["clarification"],
        // Only quiz/flashcard messages carry their respective content.
        quiz:
          toolUsed === "quiz_generator"
            ? (inner as unknown as QuizContent)
            : undefined,
        flashcards:
          toolUsed === "flashcard_generator"
            ? (inner as unknown as Message["meta"]["flashcards"])
            : undefined,
        available_actions: inner.available_actions as string[] | undefined,
        response_type: inner.response_type as string | undefined,
      },
    } satisfies Message;
  });
}

/* ---------------------------------- media --------------------------------- */

export async function uploadMedia(
  files: File[],
  sessionId?: string,
): Promise<MediaItem[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  if (sessionId) form.append("session_id", sessionId);

  const res = await fetch(`${API_BASE_URL}${ENDPOINTS.MEDIA}`, {
    method: "POST",
    headers: authHeaders(false),
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || "Upload failed");
  }
  return (await res.json()).data as MediaItem[];
}

export const listMedia = (sessionId?: string) =>
  unwrap<MediaItem[]>(
    `${ENDPOINTS.MEDIA}${sessionId ? `?session_id=${sessionId}` : ""}`,
  );

/** Upload a single file with progress events (XHR; fetch lacks upload progress). */
export function uploadFileWithProgress(
  file: File,
  sessionId: string | undefined,
  onProgress: (percent: number) => void,
): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);
    if (sessionId) form.append("session_id", sessionId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${ENDPOINTS.MEDIA}`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const items = JSON.parse(xhr.responseText).data as MediaItem[];
          resolve(items[0]);
        } catch {
          reject(new Error("Unexpected upload response"));
        }
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText).msg || msg;
        } catch {
          /* keep default */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}

export const deleteMedia = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.MEDIA_ITEM(id), { method: "DELETE" });

/* ---------------------------------- quiz ---------------------------------- */

export const listQuizzes = () =>
  unwrap<QuizListItem[]>(ENDPOINTS.QUIZZES);

export const getQuiz = async (id: string): Promise<QuizContent> => {
  // The detail endpoint may key the id as `id`; the client always needs
  // `quiz_id`, so derive it from the requested id as a guaranteed fallback.
  const q = await unwrap<QuizContent & { id?: string }>(ENDPOINTS.QUIZ(id));
  return { ...q, quiz_id: q.quiz_id ?? q.id ?? id };
};

export const submitQuiz = (
  id: string,
  answers: Record<string, string[]>,
  timeTakenSeconds = 0,
) =>
  unwrap<QuizSubmitResult>(ENDPOINTS.QUIZ_SUBMIT(id), {
    method: "POST",
    body: JSON.stringify({ answers, time_taken_seconds: timeTakenSeconds }),
  });

export const analyzeQuiz = (id: string, attemptId: string) =>
  unwrap<QuizAnalysis>(ENDPOINTS.QUIZ_ANALYZE(id), {
    method: "POST",
    body: JSON.stringify({ attempt_id: attemptId }),
  });

export const listQuizAttempts = (quizId: string) =>
  unwrap<QuizAttemptSummary[]>(ENDPOINTS.QUIZ_ATTEMPTS(quizId));

export const getQuizAttempt = async (
  quizId: string,
  attemptId: string,
): Promise<QuizAttemptDetail> => {
  const a = await unwrap<QuizAttemptDetail>(
    ENDPOINTS.QUIZ_ATTEMPT(quizId, attemptId),
  );
  // The quiz detail endpoint keys the id as `id`; the client needs `quiz_id`.
  return { ...a, quiz: { ...a.quiz, quiz_id: a.quiz.quiz_id ?? quizId } };
};

/* -------------------------------- bookmarks ------------------------------- */

export const listBookmarks = () =>
  unwrap<Bookmark[]>(ENDPOINTS.BOOKMARKS);

export const getBookmark = (id: string) =>
  unwrap<Bookmark>(ENDPOINTS.BOOKMARK(id));

export const createBookmark = (input: CreateBookmarkInput) =>
  unwrap<Bookmark>(ENDPOINTS.BOOKMARKS, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateBookmark = (
  id: string,
  patch: { collection_id?: string | null; title?: string },
) =>
  unwrap<Bookmark>(ENDPOINTS.BOOKMARK(id), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteBookmark = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.BOOKMARK(id), { method: "DELETE" });

export const listCollections = () =>
  unwrap<BookmarkCollection[]>(ENDPOINTS.COLLECTIONS);

export const createCollection = (name: string) =>
  unwrap<BookmarkCollection>(ENDPOINTS.COLLECTIONS, {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const renameCollection = (id: string, name: string) =>
  unwrap<BookmarkCollection>(ENDPOINTS.COLLECTION(id), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteCollection = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.COLLECTION(id), { method: "DELETE" });

/* ------------------------------- flashcards ------------------------------- */

export const listFlashcardSets = () =>
  unwrap<FlashcardListItem[]>(ENDPOINTS.FLASHCARDS);

export const getFlashcardSet = (id: string) =>
  unwrap<FlashcardSetDetail>(ENDPOINTS.FLASHCARD(id));

export const recordFlashcardStudy = (
  setId: string,
  flashcardId: string,
  rating: StudyRating,
) =>
  unwrap<FlashcardAnalytics>(ENDPOINTS.FLASHCARD_STUDY(setId), {
    method: "POST",
    body: JSON.stringify({ flashcard_id: flashcardId, rating }),
  });

/* --------------------------- learning profile ----------------------------- */

export const getLearningProfile = () =>
  unwrap<LearningProfile>(ENDPOINTS.LEARNING_PROFILE);

export const saveLearningProfile = (input: LearningProfileInput) =>
  unwrap<LearningProfile>(ENDPOINTS.LEARNING_PROFILE, {
    method: "PUT",
    body: JSON.stringify(input),
  });

export const skipPersonalization = () =>
  unwrap<LearningProfile>(ENDPOINTS.LEARNING_PROFILE_SKIP, {
    method: "POST",
  });

/* --------------------------------- search --------------------------------- */

export const searchAll = (q: string) =>
  unwrap<SearchResults>(`${ENDPOINTS.SEARCH}?q=${encodeURIComponent(q)}`);

/** Absolute URL for the SSE assistant stream (used by useAssistantStream). */
export const assistantStreamUrl = `${API_BASE_URL}${ENDPOINTS.ASSISTANT_STREAM}`;

export type { AssistantRequest };
