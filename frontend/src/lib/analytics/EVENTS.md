# Event catalogue

Wire names are UPPER_SNAKE_CASE (identical to the enum member). Every event automatically carries the
common context (see `README.md`): `anonymous_id`, `user_id`, `session_id`,
`session_number`, `posthog_session_id`, `page_path`, `page_name`, `page_url`,
`page_title`, `referrer`, device (`device_type`, `os`, `browser`,
`browser_version`, `screen_*`, `viewport_*`, `language`, `timezone`,
`connection_type`, `online`), campaign (`utm_*` last touch, `first_utm_*`,
`referrer_domain`, `landing_page`) and app (`app_env`, `app_version`,
`build_id`, `platform`, `is_app_mode`).

`error_kind` is always `offline | high_demand | generic`. ★ marks a
conversion-funnel step. Types are the source of truth: `events.ts`.

## Core (emitted by the SDK)

| Event | When | Properties | Hook |
|---|---|---|---|
| `SESSION_STARTED` | First event of a new analytics session | `entry_page`, `referrer_domain?`, `utm_source?`, `utm_medium?`, `utm_campaign?`, `is_new_visitor` | `service.ts` via `session.ts` |
| `SESSION_ENDED` | Lazily, when the previous session is found expired, or on logout | `duration_s`, `event_count`, `exit_page?`, `reason: timeout\|logout` | `service.ts` |
| `PAGE_ENTRY` | Route pathname changed (or first load) | `page_path`, `page_name`, `previous_path`, `entry_source: initial\|navigation\|back_forward`, `qp_session_id?`, `qp_quiz_id?`, `qp_set_id?`, `qp_file_id?`, `qp_auth_error?` | `hooks/useAnalyticsRouteTracker.ts` |
| `PAGE_EXIT` | Leaving a route, or tab hidden / pagehide | `page_path`, `page_name`, `time_on_page_s`, `exit_type: navigation\|hidden` | same |
| `CLICK` | Click on any element with `data-analytics-id` | `element_id`, `element_name?`, `element_type`, `location?`, `href?` | `clicks.ts` |

Click ids in use: `landing.nav.<slug>`, `landing.hero.explore_features`,
`sidebar.nav.<route>`.

## Auth / landing

| Event | When | Properties | Hook |
|---|---|---|---|
| ★ `LANDING_CTA_CLICKED` | Google CTA pressed | `location: hero\|navbar\|navbar_mobile\|cta_band\|features\|about\|app_welcome\|share` | `landing/GoogleButton.tsx`, `pages/AppWelcomePage.tsx` |
| `LANDING_FAQ_OPENED` | FAQ accordion item opened | `faq_index` | `landing/Faq.tsx` |
| ★ `LOGIN_STARTED` | Popup opened or redirect started | `method: popup\|redirect` | `contexts/AuthContext.tsx signInWithGoogle` |
| `LOGIN_ABANDONED` | Popup closed without tokens | — | same (popup poll) |
| `LOGIN_FAILED` | Callback had no tokens / session failed | `reason: missing_token\|session` | `pages/AuthCallback.tsx` |
| ★ `LOGIN_SUCCEEDED` | Tokens received and profile loaded | `method`, `is_new_user` | `AuthContext.loadUser("login")` |
| `LOGOUT_COMPLETED` | User confirmed logout | `source: header\|settings_modal\|settings_mobile\|settings_account\|profile_page` | `hooks/useConfirmLogout.ts` |
| `SESSION_INVALIDATED` | 401 / failed refresh forced a logout | — | `AuthContext.onSessionInvalid` |

`identify(user)` runs in `AuthContext.loadUser` (login, boot restore, refresh);
`reset()` runs first thing in `hardLogout`.

## Onboarding — `components/learning/OnboardingFlow.tsx`

| Event | When | Properties |
|---|---|---|
| `ONBOARDING_STARTED` | Welcome "Start" (first run) or edit dialog opened | `mode: first_run\|edit` |
| `ONBOARDING_STEP_COMPLETED` | A step advanced (answered or skipped) | `step`, `step_index`, `skipped`, `selection_count?` |
| ★ `ONBOARDING_COMPLETED` | Profile saved from the wizard | `steps_answered`, `has_exam_target`, `subject_count` |
| ★ `ONBOARDING_SKIPPED` | Skip-all button or dialog dismissed | `at_step_index` (−1 on the intro), `via: button\|dismiss` |
| `ONBOARDING_SAVE_FAILED` | Save rejected | `error_kind` |

## Chat — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| ★ `CHAT_MESSAGE_SENT` | `send()` passed its guards | `chat_session_id`, `is_new_session`, `message_length`, `media_count`, `intent: text\|clarification\|quiz\|flashcards\|source_seed\|followup`, `source: composer\|suggested_prompt\|followup\|slash\|seed\|revision\|action`, `voice_used`, `has_seed_context` |
| `CHAT_SESSION_CREATED` | A chat session row was created | `chat_session_id`, `space_id`, `trigger: first_message\|revision\|space\|note\|flashcard_resume\|bookmark_resume\|quiz_report_flashcards` (also `useRevisionActions`, `SpaceWorkspacePage`, `NoteEditorPage`, `FlashcardViewer`, `BookmarkDetailPage`, `QuizAttemptReport`) |
| `CHAT_SESSION_CREATE_FAILED` | Lazy create threw | `error_kind` |
| `CHAT_TOOL_SELECTED` | `tool_selected` SSE frame | `chat_session_id`, `tool` |
| `CHAT_RESPONSE_COMPLETED` | `done` frame | `chat_session_id`, `tool_used`, `response_type`, `latency_ms`, `first_token_ms`, `response_length`, `source_count`, `image_count`, `has_quiz`, `has_flashcards`, `followup_count` |
| `CHAT_RESPONSE_FAILED` | Stream error | `chat_session_id`, `error_kind`, `phase: pre_stream\|mid_stream`, `latency_ms` |
| `CHAT_RESPONSE_STOPPED` | Stop generating | `chat_session_id`, `elapsed_ms`, `had_content` |
| `CHAT_RESPONSE_RETRIED` | Retry on the error card | `chat_session_id` |
| `CHAT_CLARIFICATION_REQUESTED` | Clarification frame | `chat_session_id`, `question_count` |
| `CHAT_CLARIFICATION_ANSWERED` | Clarification submitted | `action: skip\|answer`, `answered_count` |
| `CHAT_SLASH_COMMAND_SELECTED` | Slash menu pick | `command_id` (`components/chat/ChatComposer.tsx`) |
| `CHAT_VOICE_STARTED` / `CHAT_VOICE_ENDED` / `CHAT_VOICE_FAILED` | Dictation lifecycle | `lang` / `transcript_length`, `canceled`, `duration_ms` / `code` (`ChatComposer.tsx`) |
| `CHAT_SUGGESTED_PROMPT_CLICKED` | Welcome prompt or recommendation | `kind: empty_state\|recommendation`, `action?` (`components/chat/WelcomeHome.tsx`) |
| `CHAT_ACTION_CLICKED` | Action bar under a reply | `action: primary_prompt\|flashcards\|copy\|followup\|save_note`, `action_id?`, `followup_index?` (`components/chat/SuggestedActions.tsx`) |
| `CHAT_NOTE_SAVED` / `CHAT_NOTE_SAVE_FAILED` | Save reply as note | `note_id`, `chat_session_id`, `content_length` / `error_kind` |
| `CHAT_SOURCE_CLICKED` | Web source card, document chip or inline citation | `kind: web\|document`, `media_id?`, `page?`, `position?` (`SourceCards.tsx`, `MarkdownContent.tsx`) |
| `CHAT_SESSION_OPENED` | Session chosen in sidebar / palette | `chat_session_id`, `source: sidebar\|palette` (`layout/AppLayout.tsx`) |
| `CHAT_SESSION_DELETED` | Sidebar delete | `chat_session_id`, `was_active` (`AppLayout.tsx`) |
| `CHAT_SESSION_PINNED` | Pin / unpin | `chat_session_id`, `pinned` (`chat/AppSidebar.tsx`) |
| `CHAT_NEW_STARTED` | New chat | `source: sidebar\|shortcut\|palette\|header` (`AppLayout.tsx`, `ChatPage.tsx`) |

## Media — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| `MEDIA_UPLOAD_STARTED` | Per file, after client compression | `upload_id`, `file_extension`, `mime_type`, `size_bytes`, `batch_size`, `chat_session_id`, `is_retry` |
| `MEDIA_UPLOAD_COMPLETED` | Upload HTTP done | `upload_id`, `media_id`, `mime_type`, `size_bytes`, `upload_ms` |
| `MEDIA_UPLOAD_FAILED` | Upload threw | `upload_id`, `error_kind`, `mime_type`, `size_bytes` |
| ★ `MEDIA_PROCESSING_COMPLETED` | Processing reached `ready` | `media_id`, `processing_ms`, `via: stream\|poll`, `stages_seen` |
| `MEDIA_PROCESSING_FAILED` | Processing error frame / poll failure | `media_id`, `stage_last`, `recoverable`, `processing_ms` |
| `MEDIA_UPLOAD_RETRIED` / `MEDIA_UPLOAD_DISMISSED` | Upload card actions | `upload_id`, `mode: resume\|reupload` / `upload_id`, `status` |
| `MEDIA_CONTEXT_TOGGLED` | File (de)selected as chat context | `media_id`, `selected`, `selected_count`, `refused_not_ready` |
| `MEDIA_DELETED` | Sidebar delete | `media_id`, `source` (`chat/MediaSidebar.tsx`) |
| `MEDIA_VIEWER_OPENED` | PDF/image opened | `media_id?`, `source: thumbnail\|citation\|files\|deeplink`, `kind: pdf\|image`, `page?` (`contexts/DocumentViewerContext.tsx`, `pages/FilesPage.tsx`) |
| `MEDIA_VIEWER_CLOSED` | Docked viewer closed | `duration_ms`, `fullscreen_used` (`DocumentViewerContext.tsx`) |

## Quiz

| Event | When | Properties | Hook |
|---|---|---|---|
| `QUIZ_SETUP_REQUESTED` | Setup UI opened by the assistant or `/quiz` | `chat_session_id`, `media_available`, `source: assistant\|slash` | `ChatPage.tsx` |
| `QUIZ_GENERATION_REQUESTED` | Setup submitted | `question_count`, `difficulty`, `question_types`, `use_media`, `is_exam`, `has_topic`, `has_instructions`, `source: setup\|action` | `ChatPage.handleGenerateQuiz` |
| `QUIZ_OPENED` | Quiz dashboard opened | `quiz_id`, `initial_view`, `source: chat_card\|quizzes_page\|deeplink\|bookmark` | `chat/QuizDrawer.tsx` |
| `QUIZ_STARTED` | Runner mounted (new attempt) | `quiz_id`, `question_count`, `is_exam`, `timer_seconds`, `is_retake`, `is_guest` | `quiz/QuizRunner.tsx` |
| ★ `QUIZ_COMPLETED` | Submit succeeded | `quiz_id`, `attempt_id?`, `time_taken_s`, `auto_submitted`, `answered_count`, `question_count`, `score`, `total`, `correct`, `partial`, `incorrect`, `unanswered`, `final_score?`, `max_marks?`, `is_guest` | `QuizRunner.submit` |
| `QUIZ_SUBMIT_FAILED` | Submit threw | `quiz_id`, `error_kind` | same |
| `QUIZ_ABANDONED` | Left mid-attempt after confirming | `quiz_id`, `elapsed_s` | `QuizDrawer.requestClose` |
| `QUIZ_RETAKEN` | Retake | `quiz_id` | `QuizDrawer.retake` |
| `QUIZ_ATTEMPT_OPENED` | Past attempt opened | `quiz_id`, `attempt_id` | `QuizDrawer` |
| `QUIZ_ANALYSIS_REQUESTED` / `QUIZ_FLASHCARDS_REQUESTED` | Report actions | `quiz_id`, `attempt_id?` | `quiz/QuizAttemptReport.tsx` |
| `QUIZ_QUESTION_VIEWED` | *(defined, not emitted — opt in if needed)* | `quiz_id`, `question_index` | — |
| `QUIZ_EXPORTED` / `QUIZ_SHARED` / `QUIZ_EXAM_CONFIG_UPDATED` | *(defined, not yet emitted)* | see `events.ts` | — |

## Flashcards — `components/chat/FlashcardViewer.tsx`

| Event | When | Properties |
|---|---|---|
| `FLASHCARDS_GENERATION_REQUESTED` | "Create flashcards" from a reply | `chat_session_id`, `source` (`ChatPage.tsx`) |
| `FLASHCARDS_STUDY_STARTED` | Set opened and loaded | `set_id`, `card_count`, `source: chat\|flashcards_page\|deeplink\|bookmark` |
| `FLASHCARDS_STUDY_COMPLETED` | Last card finished | `set_id`, `card_count`, `duration_s`, `rated_count`, `easy`, `medium`, `hard`, `needs_revision`, `flip_count`, `shuffled`, `review_again` |
| `FLASHCARDS_STUDY_ABANDONED` | Viewer closed with unsaved ratings | `set_id`, `rated_count`, `index` |
| `FLASHCARDS_RESUMED_IN_CHAT` | Continue in chat | `set_id`, `mode` |

## Search — `components/GlobalCommandPalette.tsx`, `layout/AppLayout.tsx`

| Event | When | Properties |
|---|---|---|
| `SEARCH_OPENED` | Palette opened | `source: shortcut\|sidebar\|header` |
| `SEARCH_PERFORMED` | Once per settled (debounced, loaded) query | `scope: global`, `query_length`, `result_count`, `has_results`, `group_counts` |
| `SEARCH_RESULT_CLICKED` | Result chosen | `scope`, `group`, `query_length` |
| `SEARCH_ACTION_CLICKED` | Quick action chosen | `action: new_chat\|revision\|bookmarks\|theme` |

## Bookmarks — `components/BookmarkButton.tsx`, `pages/BookmarksPage.tsx`, `pages/BookmarkDetailPage.tsx`

| Event | Properties |
|---|---|
| `BOOKMARK_CREATED` / `BOOKMARK_CREATE_FAILED` | `item_type`, `collection_id`, `new_collection` / `item_type`, `error_kind` |
| `BOOKMARK_REMOVED` | `bookmark_id?`, `item_type?`, `source: button\|page`, `bulk_count?` |
| `BOOKMARK_OPENED` | `bookmark_id`, `item_type` |
| `BOOKMARK_RESUMED_IN_CHAT` | `bookmark_id`, `mode`, `source: list\|detail` |
| `BOOKMARK_MOVED` | `count`, `to_collection_id` |
| `COLLECTION_CREATED` / `COLLECTION_RENAMED` / `COLLECTION_DELETED` | `collection_id` |

## Spaces / notes / revision

| Event | Properties | Hook |
|---|---|---|
| `SPACE_CREATED` / `SPACE_UPDATED` / `SPACE_DELETED` | `space_id`, `mode?` | `pages/SpacesPage.tsx`, `pages/SpaceWorkspacePage.tsx` |
| `SPACE_OPENED` | `space_id` | `SpaceWorkspacePage.tsx` |
| `SPACE_CONVERTED_FROM_CHAT` | `space_id`, `chat_session_id` | `chat/AppSidebar.tsx` |
| `NOTE_CREATED` / `NOTE_UPDATED` / `NOTE_DELETED` | `note_id`, `content_length` | `pages/NotesPage.tsx`, `pages/NoteEditorPage.tsx` |
| `NOTE_ASKED_IN_CHAT` | `note_id`, `mode` | `NoteEditorPage.tsx` |
| `REVISION_ACTION_CLICKED` | `action: revise\|quiz\|flashcards`, `has_existing_target` | `hooks/useRevisionActions.ts` |
| `CONFIDENCE_SUBMITTED` / `CONFIDENCE_SUBMIT_FAILED` | `confidence`, `source`, `ref_id?` / `source`, `error_kind` | `components/revision/ConfidencePrompt.tsx` |

## Sharing (public, anonymous) — `pages/SharePage.tsx`

| Event | Properties |
|---|---|
| `SHARE_VIEWED` | `share_id`, `kind` |
| `SHARE_RESOLVE_FAILED` | `share_id`, `kind` |

Guest quiz attempts on share pages emit `QUIZ_STARTED` / `QUIZ_COMPLETED` with
`is_guest: true`.

## Settings / profile

| Event | Properties | Hook |
|---|---|---|
| `SETTINGS_OPENED` | `section` | `contexts/SettingsContext.tsx` |
| `SETTINGS_SECTION_VIEWED` | `section` | same |
| `PREFERENCE_CHANGED` | `key: color_theme\|custom_accent\|font_size\|content_font\|reduce_motion\|compact\|voice_lang\|theme_mode`, `value` | `contexts/PreferencesContext.tsx`, `components/ThemeToggle.tsx` |
| `PREFERENCES_RESET` | — | `PreferencesContext.tsx` |
| `LEARNING_PROFILE_EDIT_STARTED` / `LEARNING_PROFILE_SAVED` / `LEARNING_PROFILE_RESET` | — / `fields_set` / — | `settings/sections/LearningProfileSection.tsx`, `OnboardingFlow.tsx` (edit mode) |

## Errors

| Event | When | Properties | Hook |
|---|---|---|---|
| `API_ERROR` | Any non-2xx / timeout / network failure in the API client (refresh calls excluded, 401 bursts deduped) | `method`, `endpoint` (ids → `:id`), `status` (0 = no response), `error_kind`, `timeout` | `lib/api.ts request()` |

Unhandled runtime exceptions are captured by PostHog's exception autocapture
(`capture_exceptions: true`), not by a custom event. Web vitals come from
PostHog's autocapture and Vercel Analytics.
