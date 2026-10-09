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
  CreateExamPlanRequest,
  ExamConfig,
  ExamDashboard,
  ExamDashboardResponse,
  ExamDayDetail,
  ExamPattern,
  ExamTopic,
  ExamTopicFlashcardsRequest,
  ExamTopicLesson,
  ExamTopicQuizRequest,
  ExamTopicStatus,
  LearningProfile,
  LearningProfileInput,
  MediaItem,
  FlashcardAnalytics,
  FlashcardGenerateRequest,
  FlashcardGenerateResult,
  FlashcardListItem,
  FlashcardSetDetail,
  Message,
  QuizAnalysis,
  QuizAttemptDetail,
  QuizAttemptSummary,
  QuizContent,
  QuizEvaluation,
  QuizExportContent,
  QuizGenerateRequest,
  QuizGenerateResult,
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
import { mapAssistantContent, mapFeedback } from "@/lib/messageMeta";
import { mapChatArtifacts } from "@/lib/chatArtifacts";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind } from "@/lib/errorMessage";
import { UploadError, reasonFromResponse } from "@/lib/uploadErrors";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 30000;
// Direct quiz/flashcard creation runs a full LLM generation in one request.
const GENERATION_TIMEOUT = 180_000;

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
  MEDIA_ATTACH: "/media/attach",
  MEDIA_UPLOAD_URL: "/media/upload-url",
  MEDIA_COMPLETE: "/media/complete",
  ASSISTANT_STREAM: "/assistant/stream",
  QUIZZES: "/quiz/",
  QUIZ_EXAM_PATTERNS: "/quiz/exam-patterns",
  QUIZ_GENERATE: "/quiz/generate",
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
  CHAT_MESSAGE_FEEDBACK: (id: string) => `/chat/messages/${id}/feedback`,
  SEARCH: "/search/",
  FLASHCARDS: "/flashcards/",
  FLASHCARDS_GENERATE: "/flashcards/generate",
  FLASHCARD: (id: string) => `/flashcards/${id}`,
  FLASHCARD_STUDY: (id: string) => `/flashcards/${id}/study`,
  FLASHCARD_STUDY_BATCH: (id: string) => `/flashcards/${id}/study/batch`,
  LEARNING_PROFILE: "/learning-profile/",
  LEARNING_PROFILE_SKIP: "/learning-profile/skip",
  ANALYTICS_OVERVIEW: "/analytics/overview",
  REVISION_DASHBOARD: "/revision/dashboard",
  REVISION_HOME: "/revision/home",
  REVISION_CONFIDENCE: "/revision/confidence",
  // Return hook: what the signed-in user has waiting (chat strip).
  NOTIFICATIONS_PENDING: "/notifications/pending",
  // Exam Prep (feature flag `exam_prep`).
  EXAM_PLAN: "/exam-prep/plan",
  EXAM_PLAN_ARCHIVE: (planId: string) => `/exam-prep/plan/${planId}/archive`,
  EXAM_DAY: (planId: string, dayId: string) =>
    `/exam-prep/plan/${planId}/days/${dayId}`,
  EXAM_TOPIC: (topicId: string) => `/exam-prep/topics/${topicId}`,
  EXAM_TOPIC_QUIZ: (topicId: string) => `/exam-prep/topics/${topicId}/quiz`,
  EXAM_TOPIC_FLASHCARDS: (topicId: string) =>
    `/exam-prep/topics/${topicId}/flashcards`,
  EXAM_TOPIC_LESSON: (topicId: string) =>
    `/exam-prep/topics/${topicId}/lesson`,
  EXAM_TOPIC_LESSON_STREAM: (topicId: string) =>
    `/exam-prep/topics/${topicId}/lesson/stream`,
  EXAM_MESSAGES: (planId: string) => `/exam-prep/plan/${planId}/messages`,
  EXAM_CHAT_STREAM: (planId: string) =>
    `/exam-prep/plan/${planId}/chat/stream`,
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
export interface RequestExtras {
  public?: boolean;
  /** Overrides the default request timeout (ms) for slow endpoints. */
  timeoutMs?: number;
  /** A 401 is handed back to the caller instead of the unauthorized
   * handler. For calls whose caller owns the outcome of a rejected token
   * (the first `/auth/me` of a sign-in: a transient refusal must not become
   * a hard logout). Every other call keeps tearing the session down. */
  skipUnauthorizedHandler?: boolean;
}

/** HTTP status of an error thrown by the API client, if it was one. */
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

// Analytics: collapse ids so `API_ERROR` groups by route, never by record.
const ID_SEGMENT =
  /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)(?=\/|$)/gi;
function normalizeEndpoint(path: string): string {
  return path.split("?")[0].replace(ID_SEGMENT, "/:id").slice(0, 120);
}
let lastUnauthorizedAt = 0;
function reportApiError(
  path: string,
  method: string,
  status: number,
  err: unknown,
  timeout: boolean,
): void {
  // Refresh failures are the auth flow's own signal (`SESSION_INVALIDATED`).
  if (path.startsWith(ENDPOINTS.AUTH_REFRESH)) return;
  // A dead token fails every in-flight call at once; report the burst once.
  if (status === 401) {
    const now = Date.now();
    if (now - lastUnauthorizedAt < 5000) return;
    lastUnauthorizedAt = now;
  }
  analytics.track(AnalyticsEvent.API_ERROR, {
    method,
    endpoint: normalizeEndpoint(path),
    status,
    error_kind: errorKind(err),
    timeout,
  });
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  extras: RequestExtras = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    extras.timeoutMs ?? TIMEOUT,
  );
  const method = (options.method ?? "GET").toUpperCase();
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
      if (
        res.status === 401 &&
        !extras.public &&
        !extras.skipUnauthorizedHandler
      ) {
        onUnauthorized();
      }
      const err = await res.json().catch(() => ({}));
      const error = Object.assign(
        new Error(err.msg || `Request failed (${res.status})`),
        { status: res.status },
      );
      reportApiError(path, method, res.status, error, false);
      throw error;
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      reportApiError(path, method, 0, "timeout", true);
    } else if (e instanceof TypeError) {
      // fetch rejected before any response (offline, DNS, CORS).
      reportApiError(path, method, 0, e, false);
    }
    throw e;
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

export const getMe = (extras?: RequestExtras) =>
  unwrap<User>(ENDPOINTS.AUTH_ME, undefined, extras);

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
        // The turn result lives under metadata.content; the same mapper as
        // the live stream, so a reloaded thread renders identically
        // (quiz/flashcard cards, images, agent roster, follow-ups).
        ...mapAssistantContent(inner, toolUsed),
        // Saved-note and exam-soon offer cards (same mapper as the stream).
        ...mapChatArtifacts(inner),
        status: md.status as Message["meta"]["status"],
        run_id: md.run_id as string | undefined,
        clarification: md.clarification as Message["meta"]["clarification"],
        // Thumbs rating saved earlier, so it survives a reload.
        feedback: mapFeedback(md.feedback),
      },
    } satisfies Message;
  });
}

/* ---------------------------------- media --------------------------------- */

/* Uploads go straight from the browser to Supabase Storage. The backend only
 * mints a signed URL for the exact path (step 1) and records the stored
 * object once it has checked its real size and type (step 3), so the limit is
 * the backend's MAX_UPLOAD_MB, not the request-body cap of its serverless
 * host. Both backend calls keep their HTTP status so the upload card can name
 * the cause (see `reasonFromResponse`). */

interface UploadTicket {
  upload_url: string;
  token: string;
  storage_path: string;
  max_bytes: number;
}

async function postForUpload<T>(path: string, body: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new UploadError("network");
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const err = (await res.json().catch(() => ({}))) as { msg?: string };
    throw new UploadError(reasonFromResponse(res.status, err.msg), res.status);
  }
  return ((await res.json()) as { data: T }).data;
}

/** PUT the file to its signed storage URL, reporting upload progress. */
function putToStorage(
  ticket: UploadTicket,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.upload_url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let body: { message?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* keep empty */
      }
      const text = body.message || body.error || "";
      // Storage names its own limit differently from the backend.
      const reason = /maximum allowed size|too large|payload/i.test(text)
        ? "too_large"
        : reasonFromResponse(xhr.status, text);
      reject(new UploadError(reason, xhr.status));
    };
    xhr.onerror = () => reject(new UploadError("network"));
    xhr.onabort = () => reject(new UploadError("network"));
    xhr.send(file);
  });
}

/** Upload a single file with progress events. */
export async function uploadFileWithProgress(
  file: File,
  sessionId: string | undefined,
  onProgress: (percent: number) => void,
): Promise<MediaItem> {
  const ticket = await postForUpload<UploadTicket>(ENDPOINTS.MEDIA_UPLOAD_URL, {
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    session_id: sessionId ?? null,
  });
  await putToStorage(ticket, file, onProgress);
  return postForUpload<MediaItem>(ENDPOINTS.MEDIA_COMPLETE, {
    storage_path: ticket.storage_path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    session_id: sessionId ?? null,
  });
}

/** Upload several files (no progress); each goes straight to storage. */
export function uploadMedia(
  files: File[],
  sessionId?: string,
): Promise<MediaItem[]> {
  return Promise.all(
    files.map((file) => uploadFileWithProgress(file, sessionId, () => {})),
  );
}

export const listMedia = (sessionId?: string) =>
  unwrap<MediaItem[]>(
    `${ENDPOINTS.MEDIA}${sessionId ? `?session_id=${sessionId}` : ""}`,
  );

export const deleteMedia = (id: string) =>
  unwrap<{ id: string }>(ENDPOINTS.MEDIA_ITEM(id), { method: "DELETE" });

/** Current processing status for a media item (polling / SSE reconnect). */
export const getMediaStatus = (id: string) =>
  unwrap<MediaItem>(ENDPOINTS.MEDIA_STATUS(id));

/** Absolute URL of the media processing SSE stream. */
export const mediaProcessUrl = (id: string) =>
  `${API_BASE_URL}${ENDPOINTS.MEDIA_PROCESS(id)}`;

/** Link files uploaded before a chat existed to the session created since. */
export const attachMedia = (sessionId: string, mediaIds: string[]) =>
  unwrap<{ session_id: string; media_ids: string[] }>(ENDPOINTS.MEDIA_ATTACH, {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, media_ids: mediaIds }),
  });

/* ---------------------------------- quiz ---------------------------------- */

export const listQuizzes = () =>
  unwrap<QuizListItem[]>(ENDPOINTS.QUIZZES);

/** Create a quiz from the Quizzes page (same generator Chat uses). */
export const generateQuiz = (body: QuizGenerateRequest) =>
  unwrap<QuizGenerateResult>(
    ENDPOINTS.QUIZ_GENERATE,
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: GENERATION_TIMEOUT },
  );

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

/* ----------------------------- answer feedback ---------------------------- */

/** Thumbs up / down on an assistant message (`null` clears it). Stored in
 *  `messages.metadata.feedback` so quality reviews can join it to traces. */
export const submitMessageFeedback = (
  messageId: string,
  rating: "up" | "down" | null,
) =>
  unwrap<{ message_id: string; rating: "up" | "down" | null }>(
    ENDPOINTS.CHAT_MESSAGE_FEEDBACK(messageId),
    { method: "POST", body: JSON.stringify({ rating }) },
  );

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

/** Create a flashcard set from the Flashcards page (same generator as Chat). */
export const generateFlashcards = (body: FlashcardGenerateRequest) =>
  unwrap<FlashcardGenerateResult>(
    ENDPOINTS.FLASHCARDS_GENERATE,
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: GENERATION_TIMEOUT },
  );

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

/* ------------------------------ return hook ------------------------------- */

/** One thing waiting for the user. `count` is topics still open today
 * (plan), topics due (revision) or unused artifacts (quiz / flashcards);
 * the id is what one tap opens. Ids and counts only, no titles. */
export type PendingNotification =
  | {
      kind: "plan";
      count: number;
      plan_id: string | null;
      day_id: string | null;
      day_number: number | null;
      total_days: number | null;
    }
  | { kind: "revision"; count: number }
  | { kind: "quiz"; count: number; quiz_id: string | null }
  | { kind: "flashcards"; count: number; set_id: string | null };

export interface PendingNotifications {
  /** False while the backend runs without `NOTIFICATIONS_ENABLED`. */
  enabled: boolean;
  /** Most important first: plan, revision, quiz, flashcards. */
  items: PendingNotification[];
}

export const getPendingNotifications = () =>
  unwrap<PendingNotifications>(
    `${ENDPOINTS.NOTIFICATIONS_PENDING}${tzQuery()}`,
  );

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

/* -------------------------------- Exam Prep ------------------------------- */
// Behind the `exam_prep` feature flag. Plan creation, lazy day detail and
// on-demand quiz/flashcards each run one LLM generation, so they use the
// generation timeout like /quiz/generate.

/** The active plan's dashboard, or `{ plan: null }` when there is none. */
export const getExamDashboard = () =>
  unwrap<ExamDashboardResponse>(ENDPOINTS.EXAM_PLAN);

/** Creates the plan and generates the lightweight roadmap (archives any
 * previous active plan). Returns the new dashboard. */
export const createExamPlan = (body: CreateExamPlanRequest) =>
  unwrap<ExamDashboard>(
    ENDPOINTS.EXAM_PLAN,
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: GENERATION_TIMEOUT },
  );

export const archiveExamPlan = (planId: string) =>
  unwrap<{ id: string; status: "archived" }>(
    ENDPOINTS.EXAM_PLAN_ARCHIVE(planId),
    { method: "POST" },
  );

/** One day with its topics; the detailed plan is generated on first open. */
export const getExamDay = (planId: string, dayId: string) =>
  unwrap<ExamDayDetail>(ENDPOINTS.EXAM_DAY(planId, dayId), undefined, {
    timeoutMs: GENERATION_TIMEOUT,
  });

export const updateExamTopicStatus = (
  topicId: string,
  status: ExamTopicStatus,
) =>
  unwrap<ExamTopic>(ENDPOINTS.EXAM_TOPIC(topicId), {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const generateExamTopicQuiz = (
  topicId: string,
  body: ExamTopicQuizRequest = {},
) =>
  unwrap<QuizGenerateResult>(
    ENDPOINTS.EXAM_TOPIC_QUIZ(topicId),
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: GENERATION_TIMEOUT },
  );

export const generateExamTopicFlashcards = (
  topicId: string,
  body: ExamTopicFlashcardsRequest = {},
) =>
  unwrap<FlashcardGenerateResult>(
    ENDPOINTS.EXAM_TOPIC_FLASHCARDS(topicId),
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: GENERATION_TIMEOUT },
  );

/** A persisted message row as the backend returns it. */
interface MessageRow {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Row → UI message, the same normalisation `getMessages` applies. */
function mapMessageRow(m: MessageRow): Message {
  const md = m.metadata ?? {};
  const inner = (md.content ?? {}) as Record<string, unknown>;
  const toolUsed = md.tool_used as Message["meta"]["tool_used"];
  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
    createdAt: new Date(m.created_at),
    meta: {
      ...mapAssistantContent(inner, toolUsed),
      status: md.status as Message["meta"]["status"],
      run_id: md.run_id as string | undefined,
      clarification: md.clarification as Message["meta"]["clarification"],
    },
  } satisfies Message;
}

/** The topic with its lesson markdown (`lesson_md` is null until generated). */
export const getExamTopicLesson = (topicId: string) =>
  unwrap<ExamTopicLesson>(ENDPOINTS.EXAM_TOPIC_LESSON(topicId));

/** History of the plan's dedicated Exam Prep conversation (newest `limit`
 * messages, oldest first). With `topicId`, only that topic's turns. */
export async function getExamMessages(
  planId: string,
  limit = 60,
  topicId?: string,
): Promise<Message[]> {
  const query = topicId
    ? `?limit=${limit}&topic_id=${encodeURIComponent(topicId)}`
    : `?limit=${limit}`;
  const rows = await unwrap<MessageRow[]>(
    `${ENDPOINTS.EXAM_MESSAGES(planId)}${query}`,
  );
  return rows.map(mapMessageRow);
}

/** Absolute URL for the Exam Prep SSE stream (useAssistantStream(url)). */
export const examChatStreamUrl = (planId: string) =>
  `${API_BASE_URL}${ENDPOINTS.EXAM_CHAT_STREAM(planId)}`;

/** Absolute URL for the topic-lesson SSE stream (same frames as chat; the
 * body is `{ regenerate?: boolean }`). */
export const examLessonStreamUrl = (topicId: string) =>
  `${API_BASE_URL}${ENDPOINTS.EXAM_TOPIC_LESSON_STREAM(topicId)}`;
