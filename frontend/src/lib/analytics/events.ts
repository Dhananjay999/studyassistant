// Single source of truth for analytics event names and their properties.
//
// Naming: wire names are UPPER_SNAKE_CASE, `<DOMAIN>_<OBJECT>_<PAST_TENSE>`
// (≤40 chars), identical to the enum member name.
//
// Privacy: property types deliberately carry lengths, counts, ids, booleans,
// enums and durations — never message text, search text, filenames, note
// bodies, transcripts, question or answer text. See sanitize.ts for the
// runtime guard and EVENTS.md for the human-readable catalogue.
//
// Adding an event = add the enum member + its props type in `EventPropsMap`
// + a row in EVENTS.md. Nothing else changes.

export enum AnalyticsEvent {
  // ---- Core (emitted by the SDK itself) ---------------------------------
  SESSION_STARTED = "SESSION_STARTED",
  SESSION_ENDED = "SESSION_ENDED",
  PAGE_ENTRY = "PAGE_ENTRY",
  PAGE_EXIT = "PAGE_EXIT",
  CLICK = "CLICK",

  // ---- Auth / landing ----------------------------------------------------
  LANDING_CTA_CLICKED = "LANDING_CTA_CLICKED",
  LANDING_DEMO_INTERACTED = "LANDING_DEMO_INTERACTED",
  LANDING_FAQ_OPENED = "LANDING_FAQ_OPENED",
  LOGIN_STARTED = "LOGIN_STARTED",
  LOGIN_ABANDONED = "LOGIN_ABANDONED",
  LOGIN_FAILED = "LOGIN_FAILED",
  LOGIN_SUCCEEDED = "LOGIN_SUCCEEDED",
  LOGOUT_COMPLETED = "LOGOUT_COMPLETED",
  SESSION_INVALIDATED = "SESSION_INVALIDATED",

  // ---- Onboarding --------------------------------------------------------
  ONBOARDING_STARTED = "ONBOARDING_STARTED",
  ONBOARDING_STEP_COMPLETED = "ONBOARDING_STEP_COMPLETED",
  ONBOARDING_COMPLETED = "ONBOARDING_COMPLETED",
  ONBOARDING_SKIPPED = "ONBOARDING_SKIPPED",
  ONBOARDING_SAVE_FAILED = "ONBOARDING_SAVE_FAILED",

  // ---- Chat --------------------------------------------------------------
  CHAT_MESSAGE_SENT = "CHAT_MESSAGE_SENT",
  CHAT_SESSION_CREATED = "CHAT_SESSION_CREATED",
  CHAT_SESSION_CREATE_FAILED = "CHAT_SESSION_CREATE_FAILED",
  CHAT_TOOL_SELECTED = "CHAT_TOOL_SELECTED",
  CHAT_RESPONSE_COMPLETED = "CHAT_RESPONSE_COMPLETED",
  CHAT_RESPONSE_FAILED = "CHAT_RESPONSE_FAILED",
  CHAT_RESPONSE_STOPPED = "CHAT_RESPONSE_STOPPED",
  CHAT_RESPONSE_RETRIED = "CHAT_RESPONSE_RETRIED",
  CHAT_CLARIFICATION_REQUESTED = "CHAT_CLARIFICATION_REQUESTED",
  CHAT_CLARIFICATION_ANSWERED = "CHAT_CLARIFICATION_ANSWERED",
  CHAT_SLASH_COMMAND_SELECTED = "CHAT_SLASH_COMMAND_SELECTED",
  CHAT_VOICE_STARTED = "CHAT_VOICE_STARTED",
  CHAT_VOICE_ENDED = "CHAT_VOICE_ENDED",
  CHAT_VOICE_FAILED = "CHAT_VOICE_FAILED",
  CHAT_SUGGESTED_PROMPT_CLICKED = "CHAT_SUGGESTED_PROMPT_CLICKED",
  CHAT_ACTION_CLICKED = "CHAT_ACTION_CLICKED",
  CHAT_NOTE_SAVED = "CHAT_NOTE_SAVED",
  CHAT_NOTE_SAVE_FAILED = "CHAT_NOTE_SAVE_FAILED",
  CHAT_SOURCE_CLICKED = "CHAT_SOURCE_CLICKED",
  CHAT_SESSION_OPENED = "CHAT_SESSION_OPENED",
  CHAT_SESSION_DELETED = "CHAT_SESSION_DELETED",
  CHAT_SESSION_PINNED = "CHAT_SESSION_PINNED",
  CHAT_NEW_STARTED = "CHAT_NEW_STARTED",

  // ---- Media -------------------------------------------------------------
  MEDIA_UPLOAD_STARTED = "MEDIA_UPLOAD_STARTED",
  MEDIA_UPLOAD_COMPLETED = "MEDIA_UPLOAD_COMPLETED",
  MEDIA_UPLOAD_FAILED = "MEDIA_UPLOAD_FAILED",
  MEDIA_PROCESSING_COMPLETED = "MEDIA_PROCESSING_COMPLETED",
  MEDIA_PROCESSING_FAILED = "MEDIA_PROCESSING_FAILED",
  MEDIA_UPLOAD_RETRIED = "MEDIA_UPLOAD_RETRIED",
  MEDIA_UPLOAD_DISMISSED = "MEDIA_UPLOAD_DISMISSED",
  MEDIA_CONTEXT_TOGGLED = "MEDIA_CONTEXT_TOGGLED",
  MEDIA_DELETED = "MEDIA_DELETED",
  MEDIA_VIEWER_OPENED = "MEDIA_VIEWER_OPENED",
  MEDIA_VIEWER_CLOSED = "MEDIA_VIEWER_CLOSED",

  // ---- Quiz --------------------------------------------------------------
  QUIZ_SETUP_REQUESTED = "QUIZ_SETUP_REQUESTED",
  QUIZ_GENERATION_REQUESTED = "QUIZ_GENERATION_REQUESTED",
  QUIZ_OPENED = "QUIZ_OPENED",
  QUIZ_STARTED = "QUIZ_STARTED",
  QUIZ_QUESTION_VIEWED = "QUIZ_QUESTION_VIEWED",
  QUIZ_COMPLETED = "QUIZ_COMPLETED",
  QUIZ_SUBMIT_FAILED = "QUIZ_SUBMIT_FAILED",
  QUIZ_ABANDONED = "QUIZ_ABANDONED",
  QUIZ_RETAKEN = "QUIZ_RETAKEN",
  QUIZ_ATTEMPT_OPENED = "QUIZ_ATTEMPT_OPENED",
  QUIZ_ANALYSIS_REQUESTED = "QUIZ_ANALYSIS_REQUESTED",
  QUIZ_FLASHCARDS_REQUESTED = "QUIZ_FLASHCARDS_REQUESTED",
  QUIZ_EXPORTED = "QUIZ_EXPORTED",
  QUIZ_SHARED = "QUIZ_SHARED",
  QUIZ_EXAM_CONFIG_UPDATED = "QUIZ_EXAM_CONFIG_UPDATED",

  // ---- Flashcards --------------------------------------------------------
  FLASHCARDS_GENERATION_REQUESTED = "FLASHCARDS_GENERATION_REQUESTED",
  FLASHCARDS_STUDY_STARTED = "FLASHCARDS_STUDY_STARTED",
  FLASHCARDS_STUDY_COMPLETED = "FLASHCARDS_STUDY_COMPLETED",
  FLASHCARDS_STUDY_ABANDONED = "FLASHCARDS_STUDY_ABANDONED",
  FLASHCARDS_RESUMED_IN_CHAT = "FLASHCARDS_RESUMED_IN_CHAT",

  // ---- Search ------------------------------------------------------------
  SEARCH_OPENED = "SEARCH_OPENED",
  SEARCH_PERFORMED = "SEARCH_PERFORMED",
  SEARCH_RESULT_CLICKED = "SEARCH_RESULT_CLICKED",
  SEARCH_ACTION_CLICKED = "SEARCH_ACTION_CLICKED",

  // ---- Bookmarks ---------------------------------------------------------
  BOOKMARK_CREATED = "BOOKMARK_CREATED",
  BOOKMARK_CREATE_FAILED = "BOOKMARK_CREATE_FAILED",
  BOOKMARK_REMOVED = "BOOKMARK_REMOVED",
  BOOKMARK_OPENED = "BOOKMARK_OPENED",
  BOOKMARK_RESUMED_IN_CHAT = "BOOKMARK_RESUMED_IN_CHAT",
  BOOKMARK_MOVED = "BOOKMARK_MOVED",
  COLLECTION_CREATED = "COLLECTION_CREATED",
  COLLECTION_RENAMED = "COLLECTION_RENAMED",
  COLLECTION_DELETED = "COLLECTION_DELETED",

  // ---- Spaces / notes / revision -----------------------------------------
  SPACE_CREATED = "SPACE_CREATED",
  SPACE_UPDATED = "SPACE_UPDATED",
  SPACE_DELETED = "SPACE_DELETED",
  SPACE_OPENED = "SPACE_OPENED",
  SPACE_CONVERTED_FROM_CHAT = "SPACE_CONVERTED_FROM_CHAT",
  NOTE_CREATED = "NOTE_CREATED",
  NOTE_UPDATED = "NOTE_UPDATED",
  NOTE_DELETED = "NOTE_DELETED",
  NOTE_ASKED_IN_CHAT = "NOTE_ASKED_IN_CHAT",
  REVISION_ACTION_CLICKED = "REVISION_ACTION_CLICKED",
  CONFIDENCE_SUBMITTED = "CONFIDENCE_SUBMITTED",
  CONFIDENCE_SUBMIT_FAILED = "CONFIDENCE_SUBMIT_FAILED",

  // ---- Sharing (public) --------------------------------------------------
  SHARE_VIEWED = "SHARE_VIEWED",
  SHARE_RESOLVE_FAILED = "SHARE_RESOLVE_FAILED",

  // ---- Settings / profile ------------------------------------------------
  SETTINGS_OPENED = "SETTINGS_OPENED",
  SETTINGS_SECTION_VIEWED = "SETTINGS_SECTION_VIEWED",
  PREFERENCE_CHANGED = "PREFERENCE_CHANGED",
  PREFERENCES_RESET = "PREFERENCES_RESET",
  LEARNING_PROFILE_EDIT_STARTED = "LEARNING_PROFILE_EDIT_STARTED",
  LEARNING_PROFILE_SAVED = "LEARNING_PROFILE_SAVED",
  LEARNING_PROFILE_RESET = "LEARNING_PROFILE_RESET",

  // ---- Errors ------------------------------------------------------------
  API_ERROR = "API_ERROR",
}

/* ------------------------------ shared types ------------------------------ */

export type ErrorKind = "offline" | "high_demand" | "generic";
export interface ErrorKindProps {
  error_kind: ErrorKind;
}

export type CtaLocation =
  | "hero"
  | "navbar"
  | "navbar_mobile"
  | "cta_band"
  | "features"
  | "about"
  | "app_welcome"
  | "share";

export type LoginMethod = "popup" | "redirect";
export type ChatSource =
  | "composer"
  | "suggested_prompt"
  | "followup"
  | "slash"
  | "seed"
  | "revision"
  | "action";
export type ChatIntent =
  | "text"
  | "clarification"
  | "quiz"
  | "flashcards"
  | "source_seed"
  | "followup";
export type ItemType = "response" | "quiz" | "media" | "note" | "flashcard";
export type Empty = Record<never, never>;

/* ---------------------------- core event props ---------------------------- */

export interface SessionStartedProps {
  entry_page: string;
  referrer_domain?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  is_new_visitor: boolean;
}
export interface SessionEndedProps {
  duration_s: number;
  event_count: number;
  exit_page?: string;
  reason: "timeout" | "logout";
}
export interface PageEntryProps {
  page_path: string;
  page_name: string;
  previous_path: string | null;
  entry_source: "initial" | "navigation" | "back_forward";
  qp_session_id?: string;
  qp_quiz_id?: string;
  qp_set_id?: string;
  qp_file_id?: string;
  qp_auth_error?: string;
}
export interface PageExitProps {
  page_path: string;
  page_name: string;
  time_on_page_s: number;
  exit_type: "navigation" | "hidden";
}
export interface ClickProps {
  element_id: string;
  element_name?: string;
  element_type: string;
  location?: string;
  href?: string;
}

/* --------------------------- feature event props -------------------------- */

export interface ChatMessageSentProps {
  chat_session_id: string | null;
  is_new_session: boolean;
  message_length: number;
  media_count: number;
  intent: ChatIntent;
  source: ChatSource;
  voice_used: boolean;
  has_seed_context: boolean;
}
export interface ChatResponseCompletedProps {
  chat_session_id: string | null;
  tool_used?: string;
  response_type?: string;
  latency_ms: number;
  first_token_ms: number | null;
  response_length: number;
  source_count: number;
  image_count: number;
  has_quiz: boolean;
  has_flashcards: boolean;
  followup_count: number;
}
export interface MediaUploadStartedProps {
  upload_id: string;
  file_extension: string;
  mime_type: string;
  size_bytes: number;
  batch_size: number;
  chat_session_id: string | null;
  is_retry: boolean;
}
export interface QuizCompletedProps {
  quiz_id: string;
  attempt_id?: string;
  time_taken_s: number;
  auto_submitted: boolean;
  answered_count: number;
  question_count: number;
  score: number;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
  unanswered: number;
  final_score?: number;
  max_marks?: number;
  is_guest: boolean;
}
export interface FlashcardsStudyCompletedProps {
  set_id: string;
  card_count: number;
  duration_s: number;
  rated_count: number;
  easy: number;
  medium: number;
  hard: number;
  needs_revision: number;
  flip_count: number;
  shuffled: boolean;
  review_again: boolean;
}
export interface SearchPerformedProps {
  scope: "global" | "space" | "list";
  query_length: number;
  result_count: number;
  has_results: boolean;
  group_counts?: Record<string, number>;
  list_page?: string;
}
export interface ApiErrorProps {
  method: string;
  endpoint: string;
  status: number;
  error_kind: ErrorKind;
  timeout: boolean;
}

/** Event → props. `Empty` means `track(event)` takes no second argument. */
export interface EventPropsMap {
  [AnalyticsEvent.SESSION_STARTED]: SessionStartedProps;
  [AnalyticsEvent.SESSION_ENDED]: SessionEndedProps;
  [AnalyticsEvent.PAGE_ENTRY]: PageEntryProps;
  [AnalyticsEvent.PAGE_EXIT]: PageExitProps;
  [AnalyticsEvent.CLICK]: ClickProps;

  [AnalyticsEvent.LANDING_CTA_CLICKED]: { location: CtaLocation };
  [AnalyticsEvent.LANDING_DEMO_INTERACTED]: {
    action: "switch" | "reveal_quiz" | "reveal_flashcards" | "nudge";
    demo_index?: number;
  };
  [AnalyticsEvent.LANDING_FAQ_OPENED]: { faq_index: number };
  [AnalyticsEvent.LOGIN_STARTED]: { method: LoginMethod };
  [AnalyticsEvent.LOGIN_ABANDONED]: Empty;
  [AnalyticsEvent.LOGIN_FAILED]: { reason: string };
  [AnalyticsEvent.LOGIN_SUCCEEDED]: { method?: LoginMethod; is_new_user: boolean };
  [AnalyticsEvent.LOGOUT_COMPLETED]: { source: string };
  [AnalyticsEvent.SESSION_INVALIDATED]: Empty;

  [AnalyticsEvent.ONBOARDING_STARTED]: { mode: "first_run" | "edit" };
  [AnalyticsEvent.ONBOARDING_STEP_COMPLETED]: {
    step: string;
    step_index: number;
    skipped: boolean;
    selection_count?: number;
  };
  [AnalyticsEvent.ONBOARDING_COMPLETED]: {
    steps_answered: number;
    has_exam_target: boolean;
    subject_count: number;
  };
  [AnalyticsEvent.ONBOARDING_SKIPPED]: {
    at_step_index: number;
    via: "button" | "dismiss";
  };
  [AnalyticsEvent.ONBOARDING_SAVE_FAILED]: ErrorKindProps;

  [AnalyticsEvent.CHAT_MESSAGE_SENT]: ChatMessageSentProps;
  [AnalyticsEvent.CHAT_SESSION_CREATED]: {
    chat_session_id: string;
    space_id: string | null;
    trigger: string;
  };
  [AnalyticsEvent.CHAT_SESSION_CREATE_FAILED]: ErrorKindProps;
  [AnalyticsEvent.CHAT_TOOL_SELECTED]: {
    chat_session_id: string | null;
    tool: string;
  };
  [AnalyticsEvent.CHAT_RESPONSE_COMPLETED]: ChatResponseCompletedProps;
  [AnalyticsEvent.CHAT_RESPONSE_FAILED]: ErrorKindProps & {
    chat_session_id: string | null;
    phase: "pre_stream" | "mid_stream";
    latency_ms: number;
  };
  [AnalyticsEvent.CHAT_RESPONSE_STOPPED]: {
    chat_session_id: string | null;
    elapsed_ms: number;
    had_content: boolean;
  };
  [AnalyticsEvent.CHAT_RESPONSE_RETRIED]: { chat_session_id: string | null };
  [AnalyticsEvent.CHAT_CLARIFICATION_REQUESTED]: {
    chat_session_id: string | null;
    question_count: number;
  };
  [AnalyticsEvent.CHAT_CLARIFICATION_ANSWERED]: {
    action: "skip" | "answer";
    answered_count: number;
  };
  [AnalyticsEvent.CHAT_SLASH_COMMAND_SELECTED]: { command_id: string };
  [AnalyticsEvent.CHAT_VOICE_STARTED]: { lang: string };
  [AnalyticsEvent.CHAT_VOICE_ENDED]: {
    transcript_length: number;
    canceled: boolean;
    duration_ms: number;
  };
  [AnalyticsEvent.CHAT_VOICE_FAILED]: { code: string };
  [AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED]: {
    kind: "empty_state" | "recommendation";
    action?: string;
  };
  [AnalyticsEvent.CHAT_ACTION_CLICKED]: {
    action: "primary_prompt" | "flashcards" | "copy" | "followup" | "save_note" | "quiz";
    action_id?: string;
    followup_index?: number;
  };
  [AnalyticsEvent.CHAT_NOTE_SAVED]: {
    note_id: string;
    chat_session_id: string | null;
    content_length: number;
  };
  [AnalyticsEvent.CHAT_NOTE_SAVE_FAILED]: ErrorKindProps;
  [AnalyticsEvent.CHAT_SOURCE_CLICKED]: {
    kind: "web" | "document";
    media_id?: string;
    page?: number;
    position?: number;
  };
  [AnalyticsEvent.CHAT_SESSION_OPENED]: {
    chat_session_id: string;
    source: string;
  };
  [AnalyticsEvent.CHAT_SESSION_DELETED]: {
    chat_session_id: string;
    was_active: boolean;
  };
  [AnalyticsEvent.CHAT_SESSION_PINNED]: {
    chat_session_id: string;
    pinned: boolean;
  };
  [AnalyticsEvent.CHAT_NEW_STARTED]: { source: string };

  [AnalyticsEvent.MEDIA_UPLOAD_STARTED]: MediaUploadStartedProps;
  [AnalyticsEvent.MEDIA_UPLOAD_COMPLETED]: {
    upload_id: string;
    media_id: string;
    mime_type: string;
    size_bytes: number;
    upload_ms: number;
  };
  [AnalyticsEvent.MEDIA_UPLOAD_FAILED]: ErrorKindProps & {
    upload_id: string;
    mime_type: string;
    size_bytes: number;
  };
  [AnalyticsEvent.MEDIA_PROCESSING_COMPLETED]: {
    media_id: string;
    processing_ms: number;
    via: "stream" | "poll";
    stages_seen: number;
  };
  [AnalyticsEvent.MEDIA_PROCESSING_FAILED]: {
    media_id: string;
    stage_last: string;
    recoverable: boolean;
    processing_ms: number;
  };
  [AnalyticsEvent.MEDIA_UPLOAD_RETRIED]: {
    upload_id: string;
    mode: "resume" | "reupload";
  };
  [AnalyticsEvent.MEDIA_UPLOAD_DISMISSED]: { upload_id: string; status: string };
  [AnalyticsEvent.MEDIA_CONTEXT_TOGGLED]: {
    media_id: string;
    selected: boolean;
    selected_count: number;
    refused_not_ready: boolean;
  };
  [AnalyticsEvent.MEDIA_DELETED]: { media_id: string; source: string };
  [AnalyticsEvent.MEDIA_VIEWER_OPENED]: {
    media_id?: string;
    source: "thumbnail" | "citation" | "files" | "deeplink";
    kind: "pdf" | "image";
    page?: number;
  };
  [AnalyticsEvent.MEDIA_VIEWER_CLOSED]: {
    duration_ms: number;
    fullscreen_used: boolean;
  };

  [AnalyticsEvent.QUIZ_SETUP_REQUESTED]: {
    chat_session_id: string | null;
    media_available: boolean;
    source: "assistant" | "slash";
  };
  [AnalyticsEvent.QUIZ_GENERATION_REQUESTED]: {
    question_count: number;
    difficulty: string;
    question_types: string[];
    use_media: boolean;
    is_exam: boolean;
    has_topic: boolean;
    has_instructions: boolean;
    source: string;
  };
  [AnalyticsEvent.QUIZ_OPENED]: {
    quiz_id: string;
    initial_view: string;
    source: string;
  };
  [AnalyticsEvent.QUIZ_STARTED]: {
    quiz_id: string;
    question_count: number;
    is_exam: boolean;
    timer_seconds: number | null;
    is_retake: boolean;
    is_guest: boolean;
  };
  [AnalyticsEvent.QUIZ_QUESTION_VIEWED]: {
    quiz_id: string;
    question_index: number;
  };
  [AnalyticsEvent.QUIZ_COMPLETED]: QuizCompletedProps;
  [AnalyticsEvent.QUIZ_SUBMIT_FAILED]: ErrorKindProps & { quiz_id: string };
  [AnalyticsEvent.QUIZ_ABANDONED]: { quiz_id: string; elapsed_s: number };
  [AnalyticsEvent.QUIZ_RETAKEN]: { quiz_id: string };
  [AnalyticsEvent.QUIZ_ATTEMPT_OPENED]: { quiz_id: string; attempt_id: string };
  [AnalyticsEvent.QUIZ_ANALYSIS_REQUESTED]: {
    quiz_id: string;
    attempt_id?: string;
  };
  [AnalyticsEvent.QUIZ_FLASHCARDS_REQUESTED]: {
    quiz_id: string;
    attempt_id?: string;
  };
  [AnalyticsEvent.QUIZ_EXPORTED]: {
    quiz_id: string;
    include_answer_key: boolean;
    paper?: string;
    success: boolean;
  };
  [AnalyticsEvent.QUIZ_SHARED]: {
    kind: "quiz" | "quiz_result";
    quiz_id: string;
    attempt_id?: string;
    channel: string;
  };
  [AnalyticsEvent.QUIZ_EXAM_CONFIG_UPDATED]: {
    quiz_id: string;
    timer_seconds: number | null;
    negative_marking: boolean;
  };

  [AnalyticsEvent.FLASHCARDS_GENERATION_REQUESTED]: {
    chat_session_id: string | null;
    source: string;
  };
  [AnalyticsEvent.FLASHCARDS_STUDY_STARTED]: {
    set_id: string;
    card_count: number;
    source: string;
  };
  [AnalyticsEvent.FLASHCARDS_STUDY_COMPLETED]: FlashcardsStudyCompletedProps;
  [AnalyticsEvent.FLASHCARDS_STUDY_ABANDONED]: {
    set_id: string;
    rated_count: number;
    index: number;
  };
  [AnalyticsEvent.FLASHCARDS_RESUMED_IN_CHAT]: { set_id: string; mode: string };

  [AnalyticsEvent.SEARCH_OPENED]: { source: "shortcut" | "sidebar" | "header" };
  [AnalyticsEvent.SEARCH_PERFORMED]: SearchPerformedProps;
  [AnalyticsEvent.SEARCH_RESULT_CLICKED]: {
    scope: "global" | "space" | "list";
    group: string;
    position?: number;
    query_length: number;
  };
  [AnalyticsEvent.SEARCH_ACTION_CLICKED]: { action: string };

  [AnalyticsEvent.BOOKMARK_CREATED]: {
    item_type: ItemType;
    collection_id: string | null;
    new_collection: boolean;
  };
  [AnalyticsEvent.BOOKMARK_CREATE_FAILED]: ErrorKindProps & { item_type: ItemType };
  [AnalyticsEvent.BOOKMARK_REMOVED]: {
    bookmark_id?: string;
    item_type?: ItemType;
    source: "button" | "page";
    bulk_count?: number;
  };
  [AnalyticsEvent.BOOKMARK_OPENED]: { bookmark_id: string; item_type: ItemType };
  [AnalyticsEvent.BOOKMARK_RESUMED_IN_CHAT]: {
    bookmark_id: string;
    mode: string;
    source: "list" | "detail";
  };
  [AnalyticsEvent.BOOKMARK_MOVED]: {
    count: number;
    to_collection_id: string | null;
  };
  [AnalyticsEvent.COLLECTION_CREATED]: { collection_id?: string };
  [AnalyticsEvent.COLLECTION_RENAMED]: { collection_id: string };
  [AnalyticsEvent.COLLECTION_DELETED]: { collection_id: string };

  [AnalyticsEvent.SPACE_CREATED]: { space_id?: string };
  [AnalyticsEvent.SPACE_UPDATED]: { space_id: string };
  [AnalyticsEvent.SPACE_DELETED]: { space_id: string; mode?: string };
  [AnalyticsEvent.SPACE_OPENED]: { space_id: string; is_general?: boolean };
  [AnalyticsEvent.SPACE_CONVERTED_FROM_CHAT]: {
    space_id?: string;
    chat_session_id: string;
  };
  [AnalyticsEvent.NOTE_CREATED]: {
    note_id?: string;
    content_length: number;
    source_type?: string;
  };
  [AnalyticsEvent.NOTE_UPDATED]: { note_id: string; content_length: number };
  [AnalyticsEvent.NOTE_DELETED]: { note_id: string };
  [AnalyticsEvent.NOTE_ASKED_IN_CHAT]: { note_id: string; mode: string };
  [AnalyticsEvent.REVISION_ACTION_CLICKED]: {
    action: string;
    has_existing_target: boolean;
  };
  [AnalyticsEvent.CONFIDENCE_SUBMITTED]: {
    confidence: string;
    source: string;
    ref_id?: string;
  };
  [AnalyticsEvent.CONFIDENCE_SUBMIT_FAILED]: ErrorKindProps & { source: string };

  [AnalyticsEvent.SHARE_VIEWED]: { share_id: string; kind: string };
  [AnalyticsEvent.SHARE_RESOLVE_FAILED]: { share_id: string; kind: string };

  [AnalyticsEvent.SETTINGS_OPENED]: { section: string };
  [AnalyticsEvent.SETTINGS_SECTION_VIEWED]: { section: string };
  [AnalyticsEvent.PREFERENCE_CHANGED]: { key: string; value: string };
  [AnalyticsEvent.PREFERENCES_RESET]: Empty;
  [AnalyticsEvent.LEARNING_PROFILE_EDIT_STARTED]: Empty;
  [AnalyticsEvent.LEARNING_PROFILE_SAVED]: { fields_set: number };
  [AnalyticsEvent.LEARNING_PROFILE_RESET]: Empty;

  [AnalyticsEvent.API_ERROR]: ApiErrorProps;
}

/** `track(event)` for `Empty` events, `track(event, props)` otherwise. */
export type TrackArgs<E extends AnalyticsEvent> =
  EventPropsMap[E] extends Empty
    ? Record<never, never> extends EventPropsMap[E]
      ? [props?: EventPropsMap[E]]
      : [props: EventPropsMap[E]]
    : [props: EventPropsMap[E]];

/** Events the SDK emits itself; providers may remap them (e.g. `$pageview`). */
export const CORE_EVENTS: ReadonlySet<string> = new Set([
  AnalyticsEvent.SESSION_STARTED,
  AnalyticsEvent.SESSION_ENDED,
  AnalyticsEvent.PAGE_ENTRY,
  AnalyticsEvent.PAGE_EXIT,
  AnalyticsEvent.CLICK,
]);
