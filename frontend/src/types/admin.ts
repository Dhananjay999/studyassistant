// Types for the hidden Super Admin panel. Kept separate from the public
// app types since the admin surface evolves independently.

export interface AdminOverview {
  total_users: number;
  total_chats: number;
  total_sessions: number;
  total_messages: number;
  total_quizzes: number;
  total_flashcard_sets: number;
  total_bookmarks: number;
  total_files: number;
  active_users: number;
  new_users_today: number;
}

export type PersonalizationStatus = "pending" | "completed" | "skipped";

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  login_provider: string;
  joined_at: string | null;
  personalization_status: PersonalizationStatus;
  last_active: string | null;
  total_chats: number;
  total_quizzes: number;
  total_flashcards: number;
  storage_used: number;
  /** Developer Mode enabled for this user. */
  is_debug_user?: boolean;
}

export interface AdminUserList {
  users: AdminUserRow[];
  total: number;
  page: number;
  page_size: number;
}

/** A user with Developer Mode enabled (GET /admin/debug-users). */
export interface AdminDebugUser {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
}

export interface AdminLearningProfile {
  education_level: string | null;
  preferred_language: string | null;
  explanation_style: string | null;
  favorite_subjects: string[];
  learning_goal: string | null;
  ai_personality?: string | null;
  communication_style?: string | null;
  custom_instructions?: string | null;
}

export interface AdminUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  login_provider: string;
  joined_at: string | null;
  personalization_status: PersonalizationStatus;
  is_debug_user?: boolean;
  learning_profile: AdminLearningProfile;
}

export interface AdminUserCounts {
  sessions: number;
  messages: number;
  quizzes: number;
  flashcards: number;
  bookmarks: number;
  files: number;
}

export interface AdminSessionRow {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface AdminQuizRow {
  id: string;
  title: string;
  topic: string;
  difficulty?: string;
  created_at: string;
}

export interface AdminFlashcardRow {
  id: string;
  title: string;
  topic: string;
  created_at: string;
}

export interface AdminBookmarkRow {
  id: string;
  title: string | null;
  item_type?: string;
  created_at: string;
}

export interface AdminFileRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface AdminUserDetail {
  profile: AdminUserProfile;
  counts: AdminUserCounts;
  storage_used: number;
  sessions: AdminSessionRow[];
  quizzes: AdminQuizRow[];
  flashcards: AdminFlashcardRow[];
  bookmarks: AdminBookmarkRow[];
  files: AdminFileRow[];
  login_history: unknown[];
}

export interface AdminMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface AdminSessionDetail {
  session: AdminSessionRow & Record<string, unknown>;
  messages: AdminMessage[];
}

/** One event in the per-user activity timeline. */
export interface AdminTimelineEvent {
  at: string;
  type: string;
  label: string;
  ref: string;
}

/** One audited admin action. */
export interface AdminAuditEntry {
  id: string;
  admin_username: string;
  action: string;
  user_id: string | null;
  resource: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/** Editable (non-sensitive) profile fields — partial update. */
export interface AdminEditProfileInput {
  full_name?: string | null;
  education_level?: string | null;
  learning_goal?: string | null;
  preferred_language?: string | null;
  explanation_style?: string | null;
  ai_personality?: string | null;
  communication_style?: string | null;
  custom_instructions?: string | null;
  favorite_subjects?: string[];
}

export interface AdminQuizQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correct_answers: string[];
  explanation?: string | null;
  sort_order: number;
}

export interface AdminQuizAttempt {
  id: string;
  score: number | null;
  created_at: string;
  answers?: Record<string, string[]>;
  evaluation?: Record<string, unknown>;
  feedback?: Record<string, unknown> | null;
}

export interface AdminQuizFullDetail {
  quiz: {
    id: string;
    title: string;
    topic: string;
    difficulty?: string;
    exam_config?: Record<string, unknown>;
    created_at: string;
  } & Record<string, unknown>;
  questions: AdminQuizQuestion[];
  attempts: AdminQuizAttempt[];
}

export interface AdminFlashcardSetDetail {
  set: {
    id: string;
    title: string;
    topic: string;
    source_type?: string;
    created_at: string;
  } & Record<string, unknown>;
  cards: Array<{
    id: string;
    front: string;
    back: string;
    example?: string | null;
    study?: { rating: string; updated_at: string } | null;
  }>;
}

/** Full media row + derived RAG state (parsed pages / embedded chunks). */
export interface AdminMediaFullDetail extends Record<string, unknown> {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  processing_status?: string;
  processing_error?: string | null;
  page_count?: number | null;
  chunk_count?: number;
  parsed_pages: number;
  embedded_chunks: number;
  signed_url: string;
}

export type UserResource =
  | "sessions"
  | "quizzes"
  | "flashcards"
  | "bookmarks"
  | "files";

export type GlobalResource =
  | "users"
  | "sessions"
  | "quizzes"
  | "flashcards"
  | "bookmarks"
  | "files";

export interface AdminUsersParams {
  q: string;
  page: number;
  page_size: number;
  sort: "created_at" | "email" | "full_name";
  order: "asc" | "desc";
  status: "all" | PersonalizationStatus;
}

export interface AdminLoginResult {
  username: string;
  token: string;
  expires_at: string;
}

export type ResourceKey =
  | "sessions"
  | "quizzes"
  | "flashcards"
  | "bookmarks"
  | "files";

// A flat row from any global resource list. Resource-specific fields are
// optional; the manager renders only the ones relevant to its resource.
export interface AdminResourceItem {
  id: string;
  created_at: string;
  updated_at?: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_name: string | null;
  title?: string;
  topic?: string;
  mode?: string;
  item_type?: string;
  source_type?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
}

export interface AdminResourceList {
  items: AdminResourceItem[];
  total: number;
  page: number;
  page_size: number;
  resource: string;
}

export interface AdminResourcesParams {
  q: string;
  user_id: string;
  page: number;
  page_size: number;
}

export interface AdminSearchHit {
  id: string;
  label: string;
  sublabel: string | null;
  user_id: string | null;
}

export interface AdminSearchResults {
  query: string;
  results: Partial<Record<"users" | ResourceKey, AdminSearchHit[]>>;
}

/** One global feature flag: registry metadata + current state.
 * `updated_at` is null while the flag is still on its code default. */
export interface AdminFeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updated_at: string | null;
}
