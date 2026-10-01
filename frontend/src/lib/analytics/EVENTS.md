# Event catalogue

Wire names are UPPER_SNAKE_CASE (identical to the enum member). Every event automatically carries the
common context (see `README.md`): `device_id`, `anonymous_id`, `user_id`, `session_id`,
`session_number`, `posthog_session_id`, `page_path`, `page_name`, `page_url`,
`page_title`, `referrer`, device (`device_type`, `os`, `browser`,
`browser_version`, `screen_*`, `viewport_*`, `language`, `timezone`,
`connection_type`, `online`), campaign (`utm_*` last touch, `first_utm_*`,
`referrer_domain`, `landing_page`) and app (`app_env`, `app_version`,
`build_id`, `platform`, `is_app_mode`).

`error_kind` is always `offline | high_demand | generic`. ★ marks a
conversion-funnel step. Types are the source of truth: `events.ts`.

The Super Admin panel reports as `page_name: admin` with `page_path` /
`page_url` / `landing_page` scrubbed to plain `/admin` (`publicPath()` in
`routeName.ts`): its real URL is a secret and never leaves the browser. Admin
lists are `data-analytics-private`; nav clicks are `ADMIN_NAV_<SECTION>_CLICK`.

## Core (emitted by the SDK)

| Event | When | Properties | Hook |
|---|---|---|---|
| `SESSION_STARTED` | First event of a new analytics session | `entry_page`, `referrer_domain?`, `utm_source?`, `utm_medium?`, `utm_campaign?`, `is_new_visitor` | `service.ts` via `session.ts` |
| `SESSION_ENDED` | Lazily, when the previous session is found expired, or on logout | `duration_s`, `event_count`, `exit_page?`, `reason: timeout\|logout` | `service.ts` |
| `PAGE_ENTRY` | Route pathname changed (or first load) | `page_path`, `page_name`, `previous_path`, `entry_source: initial\|navigation\|back_forward`, `qp_session_id?`, `qp_quiz_id?`, `qp_set_id?`, `qp_file_id?`, `qp_auth_error?` | `hooks/useAnalyticsRouteTracker.ts` |
| `PAGE_EXIT` | Leaving a route, or tab hidden / pagehide | `page_path`, `page_name`, `time_on_page_s`, `exit_type: navigation\|hidden` | same |
| `<ELEMENT>_CLICK` (e.g. `NEW_CHAT_CLICK`, `SIDEBAR_NAV_CHAT_CLICK`, `BOOKMARKS_LIST_ITEM_CLICK`) | Every press on an interactive element (button, link, menu item, tab, switch, checkbox, or anything with `data-analytics-id`). The name is the explicit id, else the label, else `<section>_ITEM` for masked rows | `event_group: "click"`, `element_id`, `element_name?`, `element_type`, `location?` (`data-analytics-location` → nearest `data-analytics-section` → landmark), `href?`, `explicit`, `label_source: attr\|aria\|title\|text\|private\|none`, `popup?` | `clicks.ts` |
| `<POPUP>_<KIND>_OPENED` (e.g. `QUIZ_DASHBOARD_DIALOG_OPENED`, `LOG_OUT_MODAL_OPENED`, `BOOKMARK_POPOVER_OPENED`) | Any Dialog / AlertDialog / Sheet / Drawer / Popover / DropdownMenu / ResponsiveModal opened. Name = explicit `analyticsName`, else the title text, else the trigger's label | `event_group: "popup_opened"`, `popup`, `kind: dialog\|alert\|sheet\|drawer\|popover\|dropdown\|modal` | `hooks/usePopupAnalytics.tsx` via `components/ui/*` |
| `<POPUP>_<KIND>_CLOSED` | The same popup closed | `event_group: "popup_closed"`, `popup`, `kind`, `duration_ms`, `via: escape\|outside\|dismiss\|unmount` | same |

Explicit click ids in use: `landing.nav.<slug>`, `landing.hero.explore_features`,
`sidebar.nav.<route>`. Every other interactive element is tracked
automatically with a label-derived id. Labels inside
`[data-analytics-private]` containers (chat thread, sidebar sessions and
spaces, quiz options, recommendations, bookmark/quiz/flashcard/file/note/space
lists, command palette, bookmark popover, media sidebar rows) are masked as
`[private]`; give a button in one of those zones a `data-analytics-name` to
label it explicitly. `data-analytics-ignore` skips an element entirely.

## Auth / landing

**Landing engagement** — `src/hooks/useLandingAnalytics.ts` (mounted on `LandingPage` and every `PublicPage`), fed by `src/lib/analytics/landing.ts`

| Event | When | Properties |
|---|---|---|
| `LANDING_VIEWED` | Public page entered | `page` (landing / features / about / privacy / terms), `auth_error?`, `visit_number` (1 = first ever visit on this browser) |
| `LANDING_SCROLL_DEPTH` | Once each at 25 / 50 / 75 / 100 % of the page seen | `page`, `depth_pct`, `time_since_entry_s` |
| `LANDING_SECTION_VIEWED` | A `[data-landing-section]` (hero, features, revision, how_it_works, what_is, faq, cta_band, footer, page_body) scrolls ≥ 35 % into view, once each | `page`, `section`, `order`, `time_since_entry_s` |
| `LANDING_CTA_VIEWED` | A Google sign-in button (`[data-cta-location]`) becomes ≥ 60 % visible, once per location (impression, for CTR) | `page`, `location`, `time_since_entry_s` |
| `LANDING_EXIT_INTENT` | Mouse leaves through the top edge (desktop), once | `page`, `time_since_entry_s`, `scroll_pct` |
| `LANDING_EXIT` | Page left (route change) or hidden (tab switch / close). The "why didn't they sign in" summary | `page`, `exit_type`, `exit_index`, `time_on_page_s`, `active_time_s`, `max_scroll_pct`, `scroll_bucket`, `sections_viewed`, `sections_viewed_count`, `deepest_section`, `cta_viewed_count`, `cta_clicked_count`, `faq_opened_count`, `demo_interactions`, `exit_intent`, `login_outcome: none\|started\|abandoned\|failed\|succeeded`, `converted`, `auth_prompt: none\|shown\|dismissed\|cta` |

`LANDING_CTA_CLICKED` now also carries `time_since_entry_s` and `scroll_pct`; `LOGIN_ABANDONED` carries `elapsed_ms` (how long the popup was open); `LANDING_DEMO_INTERACTED` fires for chip reveals, replay / dot switches, nudges and composer taps. PostHog dead-click and rage-click autocapture are on, so frustrated taps on the landing page show up as `$dead_click` / `$rageclick`.

**Sign-in prompt** — `src/components/auth/AuthPrompt.tsx`, gated by `src/lib/authPrompt.ts` (shows at most once per tab session, never again after a dismissal or a login on the device, never to signed-in users, only on `/`, `/features`, `/about`)

| Event | When | Properties |
|---|---|---|
| `AUTH_PROMPT_SHOWN` | The prompt opened (impression) | `trigger: demo_composer\|demo_action\|delayed`, `page`, `layout: modal\|sheet`, `time_since_entry_s`, `scroll_pct` |
| `AUTH_PROMPT_DISMISSED` | Closed without signing in — from now on it never shows on this device | `trigger`, `via: close\|not_now\|escape\|outside\|drag`, `duration_ms` |
| ★ `AUTH_PROMPT_CTA_CLICKED` | "Continue with Google" or "Log in" pressed inside the prompt (the Google button also emits `LANDING_CTA_CLICKED` with `location: auth_prompt`) | `trigger`, `cta: google\|login`, `duration_ms` |

The prompt is a `ResponsiveModal`, so it also emits the generic `AUTH_PROMPT_MODAL_OPENED` / `AUTH_PROMPT_MODAL_CLOSED` pair. Funnel: `AUTH_PROMPT_SHOWN` → `AUTH_PROMPT_CTA_CLICKED` → `LOGIN_STARTED` → `LOGIN_SUCCEEDED`, broken down by `trigger`.

| Event | When | Properties | Hook |
|---|---|---|---|
| ★ `LANDING_CTA_CLICKED` | Google CTA pressed | `location: hero\|navbar\|navbar_mobile\|cta_band\|features\|about\|app_welcome\|share\|auth_prompt` | `landing/GoogleButton.tsx`, `pages/AppWelcomePage.tsx`, `auth/AuthPrompt.tsx` |
| `LANDING_FAQ_OPENED` | FAQ accordion item opened | `faq_index` | `landing/Faq.tsx` |
| ★ `LOGIN_STARTED` | Popup opened or redirect started | `method: popup\|redirect` | `contexts/AuthContext.tsx signInWithGoogle` |
| `LOGIN_ABANDONED` | Popup closed without tokens or a reported failure (the sign-in issue dialog then opens) | `elapsed_ms` | same (popup poll) |
| `LOGIN_FAILED` | Sign-in ended in an error: the backend callback failed, Google denied access, the callback had no tokens, or the session could not load | `reason: missing_token\|session\|missing_code\|exchange_failed\|access_denied\|provider_error\|unknown`, `method: popup\|redirect` | popup: `AuthContext.tsx signInWithGoogle` (reported by the popup over `postMessage`); redirect: `pages/AuthCallback.tsx` |
| ★ `LOGIN_SUCCEEDED` | Tokens received and profile loaded | `method`, `is_new_user` | `AuthContext.loadUser("login")` |
| `LOGOUT_COMPLETED` | User confirmed logout | `source: header\|settings_modal\|settings_mobile\|settings_account\|profile_page` | `hooks/useConfirmLogout.ts` |
| `SESSION_INVALIDATED` | 401 / failed refresh forced a logout | — | `AuthContext.onSessionInvalid` |

After `LOGIN_ABANDONED` or `LOGIN_FAILED` the sign-in issue dialog (`auth/SigningInModal.tsx`) opens and emits `SIGN_IN_ISSUE_DIALOG_OPENED` / `SIGN_IN_ISSUE_DIALOG_CLOSED`; its buttons emit `SIGN_IN_TRY_AGAIN_CLICK` (new popup attempt) and `SIGN_IN_IN_THIS_TAB_CLICK` (full-page redirect), each followed by a fresh `LOGIN_STARTED`.

`identify(user)` runs in `AuthContext.loadUser` (login, boot restore, refresh);
`reset()` runs first thing in `hardLogout`.

## Onboarding — `components/learning/OnboardingFlow.tsx`

| Event | When | Properties |
|---|---|---|
| `ONBOARDING_STARTED` | Welcome "Start" / resumed draft (first run) or edit dialog opened | `mode: first_run\|edit`, `resumed?` |
| `ONBOARDING_STEP_VIEWED` | A first-run question was shown | `step`, `step_index`, `branch`, `visible_total` |
| `ONBOARDING_STEP_COMPLETED` | A step advanced (answered or skipped) | `step`, `step_index`, `skipped`, `selection_count?`; first run adds `branch`, `selected_id` (option id or `other` — never free text), `previous_id?`, `changed`, `has_custom_value` |
| `ONBOARDING_BACK` | Back pressed / swiped on a first-run question | `step`, `step_index`, `branch` |
| ★ `ONBOARDING_COMPLETED` | Profile saved from the wizard | `steps_answered`, `has_exam_target`, `subject_count`, `branch`, `steps_visible`, `has_custom_language` |
| ★ `ONBOARDING_SKIPPED` | Skip-all button or dialog dismissed | `at_step_index` (−1 on the intro), `via: button\|dismiss` |
| `ONBOARDING_SAVE_FAILED` | Save rejected | `error_kind` |

## Chat — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| ★ `CHAT_MESSAGE_SENT` | `send()` passed its guards | `chat_session_id`, `is_new_session`, `message_length`, `media_count`, `intent: text\|clarification\|quiz\|flashcards\|source_seed\|followup`, `source: composer\|suggested_prompt\|followup\|slash\|seed\|revision\|action`, `voice_used`, `has_seed_context` |
| `CHAT_SESSION_CREATED` | A chat session row was created | `chat_session_id`, `space_id`, `trigger: first_message\|revision\|space\|note\|flashcard_resume\|bookmark_resume\|quiz_report_flashcards` (also `useRevisionActions`, `SpaceWorkspacePage`, `NoteEditorPage`, `FlashcardViewer`, `BookmarkDetailPage`, `QuizAttemptReport`) |
| `CHAT_SESSION_CREATE_FAILED` | Lazy create threw | `error_kind` |
| `CHAT_TOOL_SELECTED` | `tool_selected` SSE frame | `chat_session_id`, `tool`, `agent_total?` (agents planned for the turn) |
| `CHAT_RESPONSE_COMPLETED` | `done` frame | `chat_session_id`, `tool_used`, `response_type`, `latency_ms`, `first_token_ms`, `response_length`, `source_count`, `image_count`, `has_quiz`, `has_flashcards`, `followup_count`, `tools_used?`, `agent_count?`, `parallel?`, `failed_agents?`, `image_style?` |
| `CHAT_AGENT_COMPLETED` | A generator agent (quiz / flashcards / image) of a multi-agent turn finished or failed (`agent_status` SSE frame) | `chat_session_id`, `tool`, `status: done\|failed`, `ms`, `input: message\|answer`, `agent_total` |
| `CHAT_AGENT_RETRIED` | "Retry" pressed on a failed agent card in the workboard | `chat_session_id`, `tool` (`components/chat/AgentWorkboard.tsx`) |
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
| `CHAT_SEND_BLOCKED` | Send refused because a selected file is still indexing (toast shown) | `reason: media_processing`, `media_count` |

## Media — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| `MEDIA_UPLOAD_STARTED` | Per file, after client compression | `upload_id`, `file_extension`, `mime_type`, `size_bytes`, `batch_size`, `chat_session_id`, `is_retry` |
| `MEDIA_UPLOAD_COMPLETED` | Upload HTTP done | `upload_id`, `media_id`, `mime_type`, `size_bytes`, `upload_ms` |
| `MEDIA_UPLOAD_FAILED` | Upload threw | `upload_id`, `error_kind`, `mime_type`, `size_bytes` |
| ★ `MEDIA_PROCESSING_COMPLETED` | Processing reached `ready` | `media_id`, `processing_ms`, `via: stream\|poll`, `stages_seen` |
| `MEDIA_PROCESSING_FAILED` | Processing error frame / poll failure | `media_id`, `stage_last`, `recoverable`, `kept?` (row kept for in-place retry), `processing_ms` |
| `MEDIA_UPLOAD_RETRIED` / `MEDIA_UPLOAD_DISMISSED` | Upload card actions, or the sidebar "Retry" on a failed (not indexed) file | `upload_id`, `mode: resume\|reupload` / `upload_id`, `status` |
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
