// Domain types for Aeva. Field names that map directly to backend payloads
// keep their snake_case to avoid mapping bugs (session_id, media_ids, ...).

export type MessageRole = "user" | "assistant";
export type ChatMode = "media" | "web_search";
export type ToolUsed =
  | "general"
  | "web_search"
  | "media_llm"
  | "quiz_generator"
  | "flashcard_generator"
  | "image_generator";
export type QuestionType = "single_select" | "multi_select" | "true_false";
export type Difficulty =
  | "beginner"
  | "easy"
  | "medium"
  | "hard"
  | "expert";

export type PersonalizationStatus = "pending" | "completed" | "skipped";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  // Onboarding state. Optional because older /auth/me payloads may omit it;
  // treat a missing value as "pending".
  personalization_status?: PersonalizationStatus;
  /** Developer Mode: admin-managed flag that unlocks debug diagnostics. */
  is_debug_user?: boolean;
}

/** Optional learning profile used to personalize Aeva's responses. */
export interface LearningProfile {
  education_level: string | null;
  preferred_language: string | null;
  explanation_style: string | null;
  favorite_subjects: string[];
  learning_goal: string | null;
  // How Aeva should behave — the persona/tone, communication style, and any
  // free-form long-term instructions the student provides.
  ai_personality: string | null;
  communication_style: string | null;
  custom_instructions: string | null;
  personalization_status: PersonalizationStatus;
  personalization_updated_at: string | null;
}

/** Patch sent when saving the learning profile (all fields optional). */
export interface LearningProfileInput {
  education_level?: string | null;
  preferred_language?: string | null;
  explanation_style?: string | null;
  favorite_subjects?: string[];
  learning_goal?: string | null;
  ai_personality?: string | null;
  communication_style?: string | null;
  custom_instructions?: string | null;
}

export interface Session {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
  /** Study Space the chat lives in (null/absent = General). */
  space_id?: string | null;
}

/* ------------------------------ Study Spaces ------------------------------ */

/** Per-space content counts, keyed by table name (backend-provided). */
export interface SpaceCounts {
  sessions?: number;
  media?: number;
  quizzes?: number;
  flashcard_sets?: number;
  bookmarks?: number;
  notes?: number;
}

/* --------------------------------- Notes ---------------------------------- */

export type NoteSourceType = "manual" | "response" | "media" | "quiz";

/** An editable markdown note (full content — GET /notes/{id}). */
export interface Note {
  id: string;
  space_id: string | null;
  title: string;
  content_md: string;
  source_type: NoteSourceType;
  source_ref?: string | null;
  created_at: string;
  updated_at: string;
}

/** List row: content trimmed to a preview server-side. */
export interface NoteListItem extends Omit<Note, "content_md"> {
  preview: string;
}

/** A subject workspace owning chats, media, quizzes, flashcards, bookmarks. */
export interface StudySpace {
  id: string;
  name: string;
  description: string;
  subject: string;
  /** App-level palette key (see lib/spaces.ts). */
  color: string;
  /** App-level icon key (see lib/spaces.ts). */
  icon: string;
  cover_url?: string | null;
  /** The user's invisible General space — hidden from spaces UI. */
  is_default: boolean;
  /** Server-managed per-space settings, incl. the AI memory digest. */
  settings?: {
    memory?: {
      recent_quizzes?: { topic: string; score: number; at: string }[];
      weak_topics?: string[];
      updated_at?: string;
    };
  };
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  counts?: SpaceCounts;
}

/** Learning-progress metrics for one space (GET /spaces/{id}/stats). */
export interface SpaceStats {
  questions_asked: number;
  media_uploaded: number;
  notes_count: number;
  quizzes_total: number;
  quizzes_completed: number;
  attempts: number;
  average_score: number;
  best_score: number;
  flashcards_reviewed: number;
  active_days: number;
  streak_days: number;
  weak_topics: { topic: string; score: number }[];
  strong_topics: { topic: string; score: number }[];
  /** 0–100 blend of engagement and mastery. */
  progress: number;
}

/** Aggregated workspace payload (GET /spaces/{id}/overview). */
export interface SpaceOverview {
  space: StudySpace;
  sessions: Pick<Session, "id" | "title" | "updated_at" | "created_at">[];
  media: {
    id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }[];
  quizzes: {
    id: string;
    title: string;
    topic: string;
    difficulty?: string;
    created_at: string;
  }[];
  flashcard_sets: {
    id: string;
    title: string;
    topic: string;
    created_at: string;
  }[];
  bookmarks: {
    id: string;
    title: string;
    item_type: string;
    item_ref?: string | null;
    created_at: string;
  }[];
  notes: {
    id: string;
    title: string;
    source_type: NoteSourceType;
    updated_at: string;
    created_at: string;
  }[];
  counts: SpaceCounts;
}

export interface SourceInfo {
  title?: string;
  url?: string;
  snippet?: string;
  // Document-citation fields (media_llm RAG answers). When present, the source
  // points at a page of an uploaded document rather than a web result.
  document_name?: string;
  page_number?: number | null;
  chunk_id?: string;
  section?: string | null;
  media_id?: string;
}

/** A source is a document citation when it carries a media id / document name. */
export function isDocSource(s: SourceInfo): boolean {
  return Boolean((s.media_id || s.document_name) && !s.url);
}

/** Input widgets the clarification planner can request (mirrors backend). */
export type ClarificationInputType =
  | "short_text"
  | "long_text"
  | "number"
  | "single_select"
  | "multi_select"
  | "chips"
  | "dropdown"
  | "radio"
  | "toggle"
  | "true_false";

export interface ClarificationQuestion {
  id: string;
  text: string;
  options?: string[] | null;
  /** Best-fit input widget; unknown/absent values render as chips. */
  input_type?: ClarificationInputType | string;
}

export interface ClarificationData {
  reason: string;
  questions: ClarificationQuestion[];
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
}

/** Exam Mode marking scheme + timer stored on a quiz ({} / undefined = an
 * ordinary practice quiz scored by accuracy only). */
export interface ExamConfig {
  pattern: string;
  correct: number;
  negative: number; // <= 0, applied per wrong answer
  skip: number;
  timer_seconds: number; // 0 = no timer
}

/** A built-in exam-pattern preset (GET /quiz/exam-patterns). */
export interface ExamPattern {
  key: string;
  label: string;
  correct: number;
  negative: number;
  skip: number;
  timer_seconds: number;
  default_type: QuestionType | null;
}

/** True when a quiz carries a usable Exam Mode config. */
export function hasExamConfig(cfg?: ExamConfig | null): cfg is ExamConfig {
  return Boolean(cfg && cfg.pattern);
}

export interface QuizContent {
  quiz_id: string;
  title: string;
  topic?: string;
  questions: QuizQuestion[];
  difficulty?: Difficulty;
  source?: string;
  /** Exam Mode config; absent/empty for ordinary practice quizzes. */
  exam_config?: ExamConfig | null;
}

/** A quiz question with its answer key, returned by GET /quiz/:id/export.
 * `correct_answers` holds the correct option *text(s)* (matched, not indexed). */
export interface QuizExportQuestion extends QuizQuestion {
  correct_answers: string[];
  explanation?: string | null;
}

/** Owner-only quiz payload for PDF export — the questions carry answers. */
export interface QuizExportContent extends Omit<QuizContent, "questions"> {
  questions: QuizExportQuestion[];
}

/* ------------------------------- sharing --------------------------------- */
// One generic sharing platform: every shareable resource gets a stable
// /share/{share_id} URL. The backend resolves the share into a normalized
// envelope; the frontend picks a renderer by `content_type`.

/** Registered shareable content types (mirrors backend resolvers). */
export type ShareContentType = "quiz" | "quiz_result" | "note";

export type ShareVisibility = "public" | "unlisted" | "private";

/** Public share link (POST /shares/). `url` is the backend share URL that
 * renders OG tags and redirects a human to the SPA. */
export interface ShareLink {
  share_id: string;
  content_type: ShareContentType;
  url: string;
}

/** Normalized public payload for any share (GET /share/:id/data). `content`
 * is typed per `content_type` by the renderer that consumes it. */
export interface ResolvedShare<T = unknown> {
  share_id: string;
  content_type: ShareContentType;
  /** Preview snapshot (title, counts, score...) taken at share time. */
  metadata: Record<string, unknown>;
  content: T;
  created_at?: string | null;
}

/** `content` of a quiz_result share. Counts only — never answers. */
export interface SharedQuizResultContent {
  quiz: {
    title: string;
    topic: string;
    difficulty: Difficulty | string;
    question_count: number;
    is_exam: boolean;
  };
  result: {
    score: number;
    total: number;
    correct_count: number;
    incorrect_count: number;
    partial_count: number;
    attempted_count: number;
    unanswered_count: number;
    time_taken_seconds: number;
    // Marks for exam attempts (null for ordinary, accuracy-only attempts).
    final_score?: number | null;
    max_marks?: number | null;
    attempted_at: string | null;
  };
  /** Companion quiz share powering the "Attempt This Quiz" CTA. */
  quiz_share_id: string | null;
}

export interface QuizPerQuestion {
  question_id: string;
  is_correct: boolean;
  partial: boolean;
  attempted: boolean;
  user_answer: string[];
  correct_answer: string[];
  explanation?: string | null;
}

export interface QuizEvaluation {
  score: number; // accuracy %, 0-100
  total: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  attempted_count: number;
  unanswered_count: number;
  time_taken_seconds?: number;
  per_question: QuizPerQuestion[];
  // Marks-based fields, present only for exam attempts (undefined otherwise).
  final_score?: number;
  max_marks?: number;
  positive_marks?: number;
  negative_marks?: number;
  skip_marks?: number;
  exam_incorrect?: number;
  marking?: { correct: number; negative: number; skip: number };
}

/** On-demand AI performance analysis (returned by /quiz/:id/analyze). */
export interface QuizAnalysis {
  strengths: string[];
  weaknesses: string[];
  common_mistakes: string[];
  revise_topics: string[];
  study_plan: string[];
}

export interface QuizFeedback {
  summary: string;
  weak_topics: string[];
  recommendations: string[];
  per_question: Array<{ question_id: string; explanation: string }>;
}

export interface QuizSubmitResult {
  attempt_id: string;
  evaluation: QuizEvaluation;
}

/** One row in a quiz's attempt history (GET /quiz/:id/attempts). */
export interface QuizAttemptSummary {
  id: string;
  attempt_number: number;
  score: number;
  total: number;
  correct_count: number;
  incorrect_count: number;
  partial_count: number;
  unanswered_count: number;
  time_taken_seconds: number;
  // Marks for exam attempts (null for ordinary, accuracy-only attempts).
  final_score?: number | null;
  max_marks?: number | null;
  created_at: string;
  is_best: boolean;
  has_analysis: boolean;
}

/** A single attempt's full report (GET /quiz/:id/attempts/:attemptId). */
export interface QuizAttemptDetail {
  attempt_id: string;
  attempt_number: number;
  quiz: QuizContent;
  answers: Record<string, string[]>;
  evaluation: QuizEvaluation;
  ai_analysis: QuizAnalysis | null;
  created_at: string;
}

// Settings the user picks in the quiz-setup popover.
export interface QuizOptions {
  topic?: string;
  question_count?: number;
  difficulty?: Difficulty;
  question_types?: QuestionType[];
  use_media?: boolean;
  /** Free-text extra guidance typed in the form; passed to the quiz tool. */
  additional_instructions?: string;
  /** Exam Mode marking scheme + timer; omitted for ordinary quizzes. */
  exam_config?: ExamConfig;
}

export interface MessageMeta {
  sources?: SourceInfo[];
  mode?: ChatMode;
  tool_used?: ToolUsed;
  status?: "clarification_required" | "quiz_setup" | "completed";
  run_id?: string;
  clarification?: ClarificationData;
  quiz?: QuizContent;
  quiz_result?: { evaluation: QuizEvaluation; feedback: QuizFeedback };
  flashcards?: FlashcardContent;
  /** Backend-driven follow-up action keys for this response (response-aware). */
  available_actions?: string[];
  /** AI-generated next questions: display title + richer hidden prompt. */
  suggested_followups?: SuggestedFollowup[];
  response_type?: string;
  /** Set when the turn failed: renders an AI-style error card (with retry). */
  error?: ChatError;
  /** Images generated by Aeva for this answer (image_generator tool). */
  images?: GeneratedImage[];
  /** Model that produced the answer (present only for debug users). */
  model?: string;
  /** Diagnostics block (present only for debug users — Developer Mode). */
  debug?: ResponseDebugInfo;
}

/**
 * Developer Mode diagnostics attached by the backend to responses of debug
 * users. Known fields get labeled rows in the debug panel; anything else the
 * backend adds later renders generically, so the two sides can evolve
 * independently.
 */
export interface ResponseDebugInfo {
  tool?: string;
  model?: string;
  model_config_key?: string | null;
  plan_source?: string;
  plan_action?: string;
  clarification_round?: boolean;
  history_messages?: number;
  media_count?: number;
  planning_ms?: number;
  tool_ms?: number;
  total_ms?: number;
  streamed?: boolean;
  [key: string]: unknown;
}

/** One AI-generated image. It IS a media-library row: `url` is the signed
 * URL from generation time; stale ones are re-resolved via the media list. */
export interface GeneratedImage {
  media_id: string;
  file_name?: string;
  url?: string;
}

/** A failed turn, surfaced as a friendly in-thread error card. */
export interface ChatError {
  /** Student-facing message (already friendly, not a raw error string). */
  message: string;
  /** The original prompt the user sent, for retry / copy. */
  prompt: string;
}

/** One AI-suggested follow-up: `title` is shown, `prompt` is what gets sent. */
export interface SuggestedFollowup {
  title: string;
  prompt: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
  meta?: MessageMeta;
  /** True while tokens are still streaming into this message. */
  streaming?: boolean;
}

export interface MediaItem {
  id: string;
  user_id: string;
  session_id: string | null;
  file_name: string;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
  signed_url?: string;
  // RAG processing lifecycle (backend migration 007). Optional because older
  // payloads omit it; a missing value is treated as ready (see isMediaReady).
  processing_status?: ProcessingStatus;
  processing_error?: string | null;
  page_count?: number | null;
}

/** A media item is usable as chat context only once it is indexed. */
export function isMediaReady(m: MediaItem): boolean {
  return (m.processing_status ?? "ready") === "ready";
}

// Backend-emitted processing stages, in pipeline order. "uploading" is a
// client-only stage (the XHR upload finishes before the SSE stream opens).
export type ProcessingStage =
  | "uploading"
  | "pending"
  | "parsing"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "error";

// A media row's persisted status. Mirrors the pipeline stages, plus "failed"
// (a recoverable failure the backend keeps for a resume).
export type ProcessingStatus = ProcessingStage | "failed";

interface StageMeta {
  /** An evocative, animated icon shown while the stage runs. */
  emoji: string;
  label: string;
  pct: number;
}

// Single source of truth for stage copy, icon, and a nominal progress value
// (used when a frame omits pct). The backend sends its own per-stage `msg`,
// which the UI prefers; these labels are the fallback. Renaming a backend
// stage is a one-line change here.
export const PROCESSING_STAGES: Record<ProcessingStage, StageMeta> = {
  uploading: { emoji: "📤", label: "Uploading your file…", pct: 8 },
  pending: { emoji: "⏳", label: "Queued for processing…", pct: 12 },
  parsing: { emoji: "📄", label: "Reading your document…", pct: 28 },
  extracting: { emoji: "🔍", label: "Extracting tables & text…", pct: 48 },
  chunking: { emoji: "📚", label: "Organizing into knowledge…", pct: 65 },
  embedding: { emoji: "⚡", label: "Generating embeddings…", pct: 82 },
  indexing: { emoji: "🧠", label: "Building knowledge index…", pct: 94 },
  ready: { emoji: "🚀", label: "Document is ready!", pct: 100 },
  error: { emoji: "⚠️", label: "Something went wrong", pct: 0 },
};

// Ordered stages for a stepper UI (terminal/synthetic stages excluded).
export const STAGE_ORDER: ProcessingStage[] = [
  "uploading",
  "parsing",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
  "ready",
];

export interface UploadProgress {
  id: string;
  // Backend media id, set once the upload resolves.
  mediaId?: string;
  name: string;
  progress: number; // 0-100 (upload pct, then processing pct)
  status: "uploading" | "processing" | "ready" | "error";
  // Current pipeline stage while status is "processing".
  stage?: ProcessingStage;
  // Latest SSE message, shown as a sub-label.
  message?: string;
  // Original file, kept in memory so a failed upload can be retried in place.
  file?: File;
  // For a failed run: true when it can be resumed, false when it must re-upload.
  recoverable?: boolean;
}

export interface ClarificationAnswer {
  action: "answer" | "custom" | "skip";
  answers?: Record<string, string>;
  custom_text?: string;
}

export interface AssistantRequest {
  message: string;
  session_id: string;
  media_ids?: string[];
  run_id?: string;
  clarification?: ClarificationAnswer;
  quiz_options?: QuizOptions;
  flashcard_options?: { count?: number };
  /** Exact card content an action targets; grounds the turn on it only. */
  source_content?: string;
}

export interface APIEnvelope<T> {
  msg: string;
  data: T;
}

// Pending clarification surfaced above the composer.
export interface PendingClarification {
  runId: string;
  data: ClarificationData;
}

// Pending quiz-setup surfaced as the setup popover. Carries whatever the
// backend already detected so the form opens pre-filled.
export interface PendingQuizSetup {
  topic: string;
  mediaAvailable: boolean;
  questionCount?: number | null;
  questionTypes?: QuestionType[] | null;
  difficulty?: Difficulty | null;
  examConfig?: ExamConfig | null;
}

/** Snapshot of the quiz-setup form, kept while the popup is dismissed so
 * reopening it restores everything the user already entered. */
export interface QuizSetupDraft {
  topic: string;
  count: string;
  level: number;
  types: QuestionType[];
  instructions: string;
  useMedia: boolean;
  exam: ExamConfig;
}

// Public, non-secret runtime config from GET /config.
export interface AppConfig {
  max_quiz_questions: number;
}

/* ------------------------------- flashcards ------------------------------- */

export type FlashcardSource =
  | "response"
  | "media"
  | "quiz"
  | "bookmark"
  | "chat";

export type StudyRating = "easy" | "medium" | "hard" | "needs_revision";

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  example?: string | null;
}

// Flashcard set as returned inline by the chat tool.
export interface FlashcardContent {
  set_id: string;
  title: string;
  topic?: string;
  cards: Flashcard[];
  source?: string;
}

export interface FlashcardAnalytics {
  total: number;
  studied: number;
  mastered: number;
  needs_revision: number;
  completion: number;
}

export interface FlashcardSetDetail {
  set_id: string;
  title: string;
  topic: string;
  source_type: FlashcardSource;
  created_at: string;
  cards: Flashcard[];
  analytics: FlashcardAnalytics;
}

export interface FlashcardListItem {
  id: string;
  set_id: string;
  session_id: string | null;
  title: string;
  topic: string;
  source_type: FlashcardSource;
  created_at: string;
  card_count: number;
  studied: number;
  mastered: number;
}

/* -------------------------------- bookmarks ------------------------------- */

export type BookmarkType =
  | "response"
  | "quiz"
  | "media"
  | "note"
  | "flashcard";

export interface BookmarkCollection {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  user_id: string;
  collection_id: string | null;
  item_type: BookmarkType;
  // Source id when known (quiz_id, media id, or message id) — used to render
  // the bookmarked state on the originating item.
  item_ref: string | null;
  // Origin conversation, resolved server-side from item_ref. Null when the
  // source was deleted or the type has no session (note/media).
  session_id?: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateBookmarkInput {
  item_type: BookmarkType;
  title?: string;
  content?: string;
  item_ref?: string | null;
  collection_id?: string | null;
  metadata?: Record<string, unknown>;
}

/* --------------------------------- quizzes -------------------------------- */

export interface QuizListItem {
  id: string;
  quiz_id: string;
  title: string;
  topic: string;
  session_id: string;
  created_at: string;
  // "easy" | "medium" | "hard" — persisted at generation time.
  difficulty: string | null;
  question_count: number;
  /** Exam Mode config; absent/empty for ordinary practice quizzes. */
  exam_config?: ExamConfig | null;
  // Best-attempt summary (null when the quiz has never been attempted).
  attempt_count: number;
  best_score: number | null;
  best_correct: number | null;
  last_attempt_at: string | null;
}

/* -------------------------------- analytics ------------------------------- */

export interface AnalyticsOverview {
  overview: {
    total_study_minutes: number;
    total_questions_asked: number;
    total_ai_responses: number;
    uploaded_documents: number;
    quizzes_created: number;
    flashcards_created: number;
    total_chats: number;
    total_bookmarks: number;
  };
  quiz_analytics: {
    attempts: number;
    quizzes_attempted: number;
    average_score: number;
    best_score: number;
    accuracy: number;
    trend: Array<{ date: string; score: number }>;
  };
  activity: Array<{ date: string; questions: number; quizzes: number }>;
  streak: number;
  subjects: Array<{ subject: string; count: number }>;
  achievements: Array<{
    key: string;
    icon: string;
    title: string;
    unlocked: boolean;
    progress: number;
    target: number;
  }>;
}

/* --------------------------------- search --------------------------------- */

export interface SearchMessageHit {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  session_title: string;
}

export interface SearchResults {
  sessions: Array<{ id: string; title: string; updated_at: string }>;
  messages: SearchMessageHit[];
  quizzes: Array<{
    id: string;
    title: string;
    topic: string;
    session_id: string;
    created_at: string;
  }>;
  media: Array<{
    id: string;
    file_name: string;
    mime_type: string;
    created_at: string;
  }>;
  flashcards: Array<{
    id: string;
    title: string;
    topic: string;
    created_at: string;
  }>;
  /** May be absent from a backend that predates migration 018. */
  notes?: Array<{
    id: string;
    title: string;
    preview: string;
    updated_at: string;
  }>;
}

// Context seeded into a new chat when resuming from saved content.
export interface ChatSeed {
  mode: "continue" | "followup" | "quiz" | "flashcards";
  content: string;
  title?: string;
  /** For followup: the question to auto-send, grounded on `content`. */
  autoSend?: string;
}
