// Typed API client for the Aeva Flask backend.
// All endpoints return the { msg, data } envelope; helpers unwrap `data`.

import type {
  AnalyticsOverview,
  APIEnvelope,
  AppConfig,
  AssistantRequest,
  Bookmark,
  BookmarkCollection,
  ConfidenceInput,
  ConfidenceResult,
  CreateBookmarkInput,
  ExamConfig,
  ExamPattern,
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
  QuizEvaluation,
  QuizExportContent,
  QuizListItem,
  QuizSubmitResult,
  ResolvedShare,
  ShareContentType,
  ShareLink,
  ShareVisibility,
  Note,
  NoteListItem,
  NoteSourceType,
  RevisionDashboard,
  RevisionHome,
  SearchResults,
  Session,
  SpaceOverview,
  SpaceStats,
  StudyRating,
  StudySpace,
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
  SPACES: "/spaces/",
  SPACE: (id: string) => `/spaces/${id}`,
  SPACE_OVERVIEW: (id: string) => `/spaces/${id}/overview`,
  SPACE_STATS: (id: string) => `/spaces/${id}/stats`,
  SPACE_CONVERT: "/spaces/convert",
  NOTES: "/notes/",
  NOTE: (id: string) => `/notes/${id}`,
  MEDIA: "/media/",
  MEDIA_ITEM: (id: string) => `/media/${id}`,
  MEDIA_STATUS: (id: string) => `/media/${id}/status`,
  MEDIA_PROCESS: (id: string) => `/media/${id}/process`,
  ASSISTANT_STREAM: "/assistant/stream",
  QUIZZES: "/quiz/",
  QUIZ_EXAM_PATTERNS: "/quiz/exam-patterns",
  QUIZ: (id: string) => `/quiz/${id}`,
  QUIZ_EXPORT: (id: string) => `/quiz/${id}/export`,
  SHARES: "/shares/",
  SHARE_MANAGE: (shareId: string) => `/shares/${shareId}`,
  SHARE_DATA: (shareId: string) => `/share/${shareId}/data`,
  SHARE_SUBMIT: (shareId: string) => `/share/${shareId}/submit`,
  QUIZ_EXAM_CONFIG: (id: string) => `/quiz/${id}/exam-config`,
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
  FLASHCARD_STUDY_BATCH: (id: string) => `/flashcards/${id}/study/batch`,
  LEARNING_PROFILE: "/learning-profile/",
  LEARNING_PROFILE_SKIP: "/learning-profile/skip",
  ANALYTICS_OVERVIEW: "/analytics/overview",
  REVISION_DASHBOARD: "/revision/dashboard",
  REVISION_HOME: "/revision/home",
  REVISION_CONFIDENCE: "/revision/confidence",
  CONFIG: "/config",
} as const;

type TokenGetter = () => string | null;

let getToken: TokenGetter = () => null;
export function setTokenGetter(getter: TokenGetter) {
  getToken = getter;
}
export function getAuthToken(): string | null {
  return getToken();
}

// Called whenever the backend rejects a request with 401 (expired/invalid
// token). AuthContext registers it to clear the session and bounce to login.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

function authHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// `public` marks an unauthenticated (guest) call: a 401 must NOT tear down the
// session, since there is no session to lose — it would wrongly bounce a
// logged-out visitor toward login on a public share page.
interface RequestExtras {
  public?: boolean;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  extras: RequestExtras = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      // An expired/invalid token surfaces as 401 here (the proactive refresh
      // timer failed or never ran). Tear the session down so the app logs out —
      // but never for an intentionally public call.
      if (res.status === 401 && !extras.public) onUnauthorized();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.msg || `Request failed (${res.status})`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function unwrap<T>(
  path: string,
  options?: RequestInit,
  extras?: RequestExtras,
): Promise<T> {
  return request<APIEnvelope<T>>(path, options, extras).then((r) => r.data);
}

/* --------------------------------- config --------------------------------- */

// Public endpoint; returns a raw (non-enveloped) object.
export const getAppConfig = () =>
  request<AppConfig>(ENDPOINTS.CONFIG);

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
  spaceId?: string,
) =>
  unwrap<Session>(ENDPOINTS.SESSIONS, {
    method: "POST",
    body: JSON.stringify({
      title,
      mode,
      media_ids: mediaIds,
      space_id: spaceId ?? null,
    }),
  });

/* ------------------------------ Study Spaces ------------------------------ */

export interface SpaceStyleInput {
  subject?: string;
  description?: string;
  color?: string;
  icon?: string;
}

export const listSpaces = () => unwrap<StudySpace[]>(ENDPOINTS.SPACES);

export const createSpace = (input: SpaceStyleInput & { name: string }) =>
  unwrap<StudySpace>(ENDPOINTS.SPACES, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateSpace = (
  id: string,
  patch: SpaceStyleInput & { name?: string },
) =>
  unwrap<StudySpace>(ENDPOINTS.SPACE(id), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

/** mode "move" re-files contents into General; "purge" deletes them. */
export const deleteSpace = (id: string, mode: "move" | "purge" = "move") =>
  unwrap<{ id: string; mode: string }>(
    `${ENDPOINTS.SPACE(id)}?mode=${mode}`,
    { method: "DELETE" },
  );

export const getSpaceOverview = (id: string) =>
  unwrap<SpaceOverview>(ENDPOINTS.SPACE_OVERVIEW(id));

export const getSpaceStats = (id: string) =>
  unwrap<SpaceStats>(ENDPOINTS.SPACE_STATS(id));

export const convertSessionToSpace = (
  input: SpaceStyleInput & { session_id: string; name?: string },
) =>
  unwrap<StudySpace>(ENDPOINTS.SPACE_CONVERT, {
    method: "POST",
    body: JSON.stringify(input),
  });

/* ---------------------------------- notes ---------------------------------- */

export interface CreateNoteInput {
  title?: string;
  content_md?: string;
  source_type?: NoteSourceType;
  source_ref?: string;
  space_id?: string;
  /** Locates the Study Space when saving from a chat. */
  session_id?: string;
}

export const listNotes = (spaceId?: string) =>
  unwrap<NoteListItem[]>(
    spaceId
      ? `${ENDPOINTS.NOTES}?space_id=${encodeURIComponent(spaceId)}`
      : ENDPOINTS.NOTES,
  );

export const getNote = (id: string) => unwrap<Note>(ENDPOINTS.NOTE(id));

export const createNote = (input: CreateNoteInput) =>
  unwrap<Note>(ENDPOINTS.NOTES, {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateNote = (
  id: string,
  patch: { title?: string; content_md?: string; space_id?: string | null },
) =>
  unwrap<Note>(ENDPOINTS.NOTE(id), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteNote = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.NOTE(id), { method: "DELETE" });

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
        // Present only for Developer Mode users (backend attaches them).
        model: inner.model as string | undefined,
        debug: inner.debug as Message["meta"]["debug"],
        images: inner.images as Message["meta"]["images"],
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

/** Current processing status for a media item (polling / SSE reconnect). */
export const getMediaStatus = (id: string) =>
  unwrap<MediaItem>(ENDPOINTS.MEDIA_STATUS(id));

/** Absolute URL of the media processing SSE stream. */
export const mediaProcessUrl = (id: string) =>
  `${API_BASE_URL}${ENDPOINTS.MEDIA_PROCESS(id)}`;

/* ---------------------------------- quiz ---------------------------------- */

export const listQuizzes = () =>
  unwrap<QuizListItem[]>(ENDPOINTS.QUIZZES);

export const listExamPatterns = () =>
  unwrap<ExamPattern[]>(ENDPOINTS.QUIZ_EXAM_PATTERNS);

export const updateQuizExamConfig = (id: string, examConfig: ExamConfig) =>
  unwrap<{ quiz_id: string; exam_config: ExamConfig }>(
    ENDPOINTS.QUIZ_EXAM_CONFIG(id),
    { method: "PATCH", body: JSON.stringify({ exam_config: examConfig }) },
  );

export const getQuiz = async (id: string): Promise<QuizContent> => {
  // The detail endpoint may key the id as `id`; the client always needs
  // `quiz_id`, so derive it from the requested id as a guaranteed fallback.
  const q = await unwrap<QuizContent & { id?: string }>(ENDPOINTS.QUIZ(id));
  return { ...q, quiz_id: q.quiz_id ?? q.id ?? id };
};

/** Owner-only quiz payload incl. correct answers, for the PDF export. */
export const getQuizExport = async (
  id: string,
): Promise<QuizExportContent> => {
  const q = await unwrap<QuizExportContent & { id?: string }>(
    ENDPOINTS.QUIZ_EXPORT(id),
  );
  return { ...q, quiz_id: q.quiz_id ?? q.id ?? id };
};

/* --------------------------------- sharing -------------------------------- */
// One generic API for every shareable content type — see types ShareLink /
// ResolvedShare. Adding a shareable feature needs no new endpoints here.

/** Owner: create/reuse the stable public share link for any resource. */
export const createShare = (
  contentType: ShareContentType,
  contentId: string,
  visibility?: ShareVisibility,
) =>
  unwrap<ShareLink>(ENDPOINTS.SHARES, {
    method: "POST",
    body: JSON.stringify({
      content_type: contentType,
      content_id: contentId,
      ...(visibility ? { visibility } : {}),
    }),
  });

/** Owner: share settings + central analytics for one share. */
export const getShare = (shareId: string) =>
  unwrap<ShareLink & { visibility: ShareVisibility; analytics: unknown }>(
    ENDPOINTS.SHARE_MANAGE(shareId),
  );

/** Owner: change a share's visibility. */
export const updateShareVisibility = (
  shareId: string,
  visibility: ShareVisibility,
) =>
  unwrap<{ share_id: string; visibility: ShareVisibility }>(
    ENDPOINTS.SHARE_MANAGE(shareId),
    { method: "PATCH", body: JSON.stringify({ visibility }) },
  );

/** Owner: revoke a share; its public link stops resolving. */
export const deleteShare = (shareId: string) =>
  unwrap<{ share_id: string }>(ENDPOINTS.SHARE_MANAGE(shareId), {
    method: "DELETE",
  });

/** Public (guest): resolve any share into its normalized payload. */
export const resolveShare = <T = unknown>(shareId: string) =>
  unwrap<ResolvedShare<T>>(ENDPOINTS.SHARE_DATA(shareId), undefined, {
    public: true,
  });

/** Public (guest): submit a shared-quiz attempt; scored server-side. */
export const submitSharedQuiz = (
  shareId: string,
  answers: Record<string, string[]>,
  timeTakenSeconds = 0,
) =>
  unwrap<{ evaluation: QuizEvaluation }>(
    ENDPOINTS.SHARE_SUBMIT(shareId),
    {
      method: "POST",
      body: JSON.stringify({
        answers,
        time_taken_seconds: timeTakenSeconds,
      }),
    },
    { public: true },
  );

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

/** Persist a whole study session's ratings in one request (client studies
 *  offline, then saves once on completion). */
export const recordFlashcardStudyBatch = (
  setId: string,
  ratings: { flashcard_id: string; rating: StudyRating }[],
) =>
  unwrap<FlashcardAnalytics>(ENDPOINTS.FLASHCARD_STUDY_BATCH(setId), {
    method: "POST",
    body: JSON.stringify({ ratings }),
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

/* -------------------------------- analytics ------------------------------- */

export const getAnalytics = () =>
  unwrap<AnalyticsOverview>(ENDPOINTS.ANALYTICS_OVERVIEW);

/* -------------------------------- revision -------------------------------- */

// Local timezone offset (minutes east of UTC) so the backend buckets
// "due today" / "yesterday" against the student's calendar day.
const tzQuery = () => `?tz_offset_minutes=${-new Date().getTimezoneOffset()}`;

export const getRevisionDashboard = () =>
  unwrap<RevisionDashboard>(`${ENDPOINTS.REVISION_DASHBOARD}${tzQuery()}`);

export const getRevisionHome = () =>
  unwrap<RevisionHome>(`${ENDPOINTS.REVISION_HOME}${tzQuery()}`);

export const postRevisionConfidence = (input: ConfidenceInput) =>
  unwrap<ConfidenceResult>(ENDPOINTS.REVISION_CONFIDENCE, {
    method: "POST",
    body: JSON.stringify(input),
  });

/* --------------------------------- search --------------------------------- */

export const searchAll = (q: string, spaceId?: string) =>
  unwrap<SearchResults>(
    `${ENDPOINTS.SEARCH}?q=${encodeURIComponent(q)}` +
      (spaceId ? `&space_id=${encodeURIComponent(spaceId)}` : ""),
  );

/** Download the whole space as a markdown document (raw text response). */
export async function exportSpaceMarkdown(id: string): Promise<string> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE_URL}/spaces/${id}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  return res.text();
}

/** Absolute URL for the SSE assistant stream (used by useAssistantStream). */
export const assistantStreamUrl = `${API_BASE_URL}${ENDPOINTS.ASSISTANT_STREAM}`;

export type { AssistantRequest };
