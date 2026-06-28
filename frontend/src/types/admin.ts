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
}

export interface AdminUserList {
  users: AdminUserRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminLearningProfile {
  education_level: string | null;
  preferred_language: string | null;
  explanation_style: string | null;
  favorite_subjects: string[];
  learning_goal: string | null;
}

export interface AdminUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  login_provider: string;
  joined_at: string | null;
  personalization_status: PersonalizationStatus;
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
