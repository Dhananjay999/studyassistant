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

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
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
  title: string;
  url?: string;
  snippet?: string;
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

export interface QuizEvaluation {
  score: number;
  correct_count: number;
  total: number;
  per_question: Array<{
    question_id: string;
    is_correct: boolean;
    user_answer: string[];
    correct_answer: string[];
  }>;
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
  feedback: QuizFeedback;
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
}

export interface UploadProgress {
  id: string;
  name: string;
  progress: number; // 0-100
  status: "uploading" | "error";
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
