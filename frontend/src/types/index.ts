// Domain types for Aeva. Field names that map directly to backend payloads
// keep their snake_case to avoid mapping bugs (session_id, media_ids, ...).

export type MessageRole = "user" | "assistant";
export type ChatMode = "media" | "web_search";
export type ToolUsed =
  | "web_search"
  | "media_llm"
  | "quiz_generator"
  | "flashcard_generator";
export type QuestionType = "single_select" | "multi_select" | "true_false";
export type Difficulty = "easy" | "medium" | "hard";

export type PersonalizationStatus = "pending" | "completed" | "skipped";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  // Onboarding state. Optional because older /auth/me payloads may omit it;
  // treat a missing value as "pending".
  personalization_status?: PersonalizationStatus;
}

/** Optional learning profile used to personalize Aeva's responses. */
export interface LearningProfile {
  education_level: string | null;
  preferred_language: string | null;
  explanation_style: string | null;
  favorite_subjects: string[];
  learning_goal: string | null;
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
}

export interface Session {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
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

export interface ClarificationQuestion {
  id: string;
  text: string;
  options?: string[] | null;
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

export interface QuizContent {
  quiz_id: string;
  title: string;
  topic?: string;
  questions: QuizQuestion[];
  difficulty?: Difficulty;
  source?: string;
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
  response_type?: string;
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

// Pending quiz-setup surfaced as the setup popover.
export interface PendingQuizSetup {
  topic: string;
  mediaAvailable: boolean;
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
  question_count: number;
  // Best-attempt summary (null when the quiz has never been attempted).
  attempt_count: number;
  best_score: number | null;
  best_correct: number | null;
  last_attempt_at: string | null;
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
}

// Context seeded into a new chat when resuming from saved content.
export interface ChatSeed {
  mode: "continue" | "followup" | "quiz" | "flashcards";
  content: string;
  title?: string;
  /** For followup: the question to auto-send, grounded on `content`. */
  autoSend?: string;
}
