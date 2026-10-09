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
The overview's engagement drill-down reports as
`ENGAGEMENT_<RETURNING|NEW|ACTIVE>_USERS_CLICK` (the chips),
`ENGAGEMENT_USERS_SHEET_OPENED` / `_CLOSED` (the sheet) and `OPEN_USER_CLICK`
in section `admin_engagement_users` (the rows, masked).

## Core (emitted by the SDK)

| Event | When | Properties | Hook |
|---|---|---|---|
| `SESSION_STARTED` | First event of a new analytics session | `entry_page`, `referrer_domain?`, `utm_source?`, `utm_medium?`, `utm_campaign?`, `is_new_visitor` | `service.ts` via `session.ts` |
| `SESSION_ENDED` | Lazily, when the previous session is found expired, or on logout | `duration_s`, `event_count`, `exit_page?`, `reason: timeout\|logout` | `service.ts` |
| `PAGE_ENTRY` | Route pathname changed (or first load) | `page_path`, `page_name`, `previous_path`, `entry_source: initial\|navigation\|back_forward`, `qp_session_id?`, `qp_quiz_id?`, `qp_set_id?`, `qp_file_id?`, `qp_auth_error?` | `hooks/useAnalyticsRouteTracker.ts` |
| `PAGE_EXIT` | Leaving a route, or tab hidden / pagehide | `page_path`, `page_name`, `time_on_page_s`, `exit_type: navigation\|hidden` | same |
| `<ELEMENT>_CLICK` (e.g. `NEW_CHAT_CLICK`, `SIDEBAR_NAV_CHAT_CLICK`, `BOOKMARKS_LIST_ITEM_CLICK`) | Every press on an interactive element (button, link, menu item, tab, switch, checkbox, or anything with `data-analytics-id`). The name is the explicit id, else the label, else `<section>_ITEM` for masked rows, else `<section>_TEXT` when the visible text looks user-typed (email, URL, sentence, long number, more than four words) | `event_group: "click"`, `element_id`, `element_name?` (`[private]` / `[text_masked]` when masked), `element_type`, `location?` (`data-analytics-location` → nearest `data-analytics-section` → landmark), `href?`, `explicit`, `label_source: attr\|aria\|title\|text\|text_masked\|private\|none`, `text_hash?` (8-hex hash of a masked label, never the text), `popup?` | `clicks.ts` |
| `<POPUP>_<KIND>_OPENED` (e.g. `QUIZ_DASHBOARD_DIALOG_OPENED`, `LOG_OUT_MODAL_OPENED`, `BOOKMARK_POPOVER_OPENED`) | Any Dialog / AlertDialog / Sheet / Drawer / Popover / DropdownMenu / ResponsiveModal opened. Name = explicit `analyticsName`, else the title text, else the trigger's label | `event_group: "popup_opened"`, `popup`, `kind: dialog\|alert\|sheet\|drawer\|popover\|dropdown\|modal` | `hooks/usePopupAnalytics.tsx` via `components/ui/*` |
| `<POPUP>_<KIND>_CLOSED` | The same popup closed | `event_group: "popup_closed"`, `popup`, `kind`, `duration_ms`, `via: escape\|outside\|dismiss\|unmount` | same |

Explicit click ids in use: `landing.nav.<slug>`, `landing.hero.explore_features`,
`sidebar.nav.<route>`. Every other interactive element is tracked
automatically with a label-derived id. Labels inside
`[data-analytics-private]`, `.ph-no-capture` or `[data-analytics-user-content]`
containers (chat thread, sidebar sessions and
spaces, quiz options, recommendations, bookmark/quiz/flashcard/file/note/space
lists, command palette, bookmark popover, media sidebar rows) are masked as
`[private]`; give a button in one of those zones a `data-analytics-name` to
label it explicitly. `data-analytics-ignore` skips an element entirely.
Outside those zones a visible-text label is still only used when it reads
like a fixed caption; anything that could be user-typed (an email address, a
URL, a sentence or question, a long number, more than four words) is masked
as `[text_masked]`, named `<LOCATION>_TEXT_CLICK` and carries `text_hash`
instead (2026-10-09; earlier builds produced names such as
`CAN_YOU_RECOMMAND_THE_I_PHONE_17_M_CLICK`, listed for deletion in the
product-intelligence data repairs). Static labels must stay short, or get an
`aria-label` / `data-analytics-name`.

A button whose visible text is personal or user-specific always carries an
explicit `data-analytics-name`, so that text never becomes an event name:
the account buttons (`ACCOUNT_SETTINGS_CLICK` in the sidebar,
`PROFILE_ACCOUNT_CLICK` on the profile and mobile settings pages, which show
the person's name and email) and the starter prompts (`SUGGESTED_PROMPT_CLICK`).

## Auth / landing

**Landing engagement** — `src/hooks/useLandingAnalytics.ts` (mounted on `LandingPage` and every `PublicPage`), fed by `src/lib/analytics/landing.ts`

| Event | When | Properties |
|---|---|---|
| `LANDING_VIEWED` | Public page entered | `page` (landing / features / about / privacy / terms), `auth_error?`, `visit_number` (1 = first ever visit on this browser) |
| `LANDING_SCROLL_DEPTH` | Once each at 25 / 50 / 75 / 100 % of the page seen | `page`, `depth_pct`, `time_since_entry_s` |
| `LANDING_SECTION_VIEWED` | A `[data-landing-section]` (hero, features, revision, exam_prep, how_it_works, what_is, faq, cta_band, footer, page_body) scrolls ≥ 35 % into view, once each | `page`, `section`, `order`, `time_since_entry_s` |
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
| ★ `LOGIN_STARTED` | Popup opened or redirect started. Since 2026-10-09 every device uses the same-tab `redirect` (the desktop popup is an opt-in behind `VITE_POPUP_SIGN_IN=true`); touch devices always did | `method: popup\|redirect` | `contexts/AuthContext.tsx signInWithGoogle` |
| `LOGIN_ABANDONED` | Popup closed without tokens or a reported failure (the sign-in issue dialog then opens); the user pressed Cancel in the signing-in dialog (`via: cancel`, no issue dialog); or a same-tab redirect came back to the site without passing through `/auth/callback` (`via: returned`: back button, reload, bounce; `elapsed_ms` is then the time away) | `elapsed_ms`, `via?: cancel\|returned` | same (popup poll, `cancelSignIn`, boot / `pageshow` via `lib/signInRedirect.ts`) |
| `LOGIN_FAILED` | Sign-in ended in an error: the backend callback failed, Google denied access, the callback had no tokens, or the session could not load (`reason: session` — the first `/auth/me` failed twice, 1 s apart; `status` and `error_kind` describe that call, never its text) | `reason: missing_token\|session\|missing_code\|exchange_failed\|access_denied\|provider_error\|unknown`, `method: popup\|redirect`, `status?`, `error_kind?: offline\|high_demand\|generic` | popup: `AuthContext.tsx signInWithGoogle` (reported by the popup over `postMessage`); redirect: `pages/AuthCallback.tsx` |
| `LOGIN_CALLBACK_LOADED` | `/auth/callback` ran: the backend's side of the sign-in is over, before the app tries the token. Reconciles backend (Supabase `/token`) and frontend (`LOGIN_SUCCEEDED` / `LOGIN_FAILED`) outcomes; a `LOGIN_STARTED method=redirect` with neither this nor `LOGIN_ABANDONED via=returned` never came back at all | `has_tokens`, `in_popup`, `auth_error?` (same enum as `LOGIN_FAILED.reason`), `elapsed_ms?` (since the redirect left) | `pages/AuthCallback.tsx` |
| ★ `LOGIN_SUCCEEDED` | Tokens received and profile loaded | `method`, `is_new_user` | `AuthContext.loadUser("login")` |
| `LOGOUT_COMPLETED` | User confirmed logout | `source: header\|settings_modal\|settings_mobile\|settings_account\|profile_page` | `hooks/useConfirmLogout.ts` |
| `SESSION_INVALIDATED` | 401 / failed refresh forced a logout. Since 2026-10-09 not for the first `/auth/me` of a sign-in: that path reports `LOGIN_FAILED reason=session` instead of a hard logout | — | `AuthContext.onSessionInvalid` |

After `LOGIN_ABANDONED` or `LOGIN_FAILED` the sign-in issue dialog (`auth/SigningInModal.tsx`) opens and emits `SIGN_IN_ISSUE_DIALOG_OPENED` / `SIGN_IN_ISSUE_DIALOG_CLOSED`. Its primary button is the same-tab sign-in and emits `SIGN_IN_IN_THIS_TAB_CLICK` (full-page redirect; labelled "Try again" when the popup is off, which is the default since 2026-10-09); `SIGN_IN_TRY_AGAIN_CLICK` (new popup attempt) is the secondary button and only exists while the popup opt-in is on. Each is followed by a fresh `LOGIN_STARTED`. While the popup is open, the signing-in dialog's Cancel button emits `SIGN_IN_CANCEL_CLICK`, then `LOGIN_ABANDONED` with `via: cancel` (no Cancel while a redirect is leaving the tab).

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
| ★ `CHAT_MESSAGE_SENT` | `send()` passed its guards | `chat_session_id`, `is_new_session`, `message_length`, `media_count`, `intent: text\|clarification\|quiz\|flashcards\|source_seed\|followup`, `source: composer\|suggested_prompt\|followup\|slash\|seed\|revision\|action\|auto_demo`, `voice_used`, `has_seed_context`, `is_first_message?` (no chat session existed yet), `regenerate?` ("Regenerate" re-sent the previous user message) |
| `CHAT_SESSION_CREATED` | A chat session row was created | `chat_session_id`, `space_id`, `trigger: first_message\|revision\|space\|note\|flashcard_resume\|bookmark_resume\|quiz_report_flashcards` (also `useRevisionActions`, `SpaceWorkspacePage`, `NoteEditorPage`, `FlashcardViewer`, `BookmarkDetailPage`, `QuizAttemptReport`) |
| `CHAT_SESSION_CREATE_FAILED` | Lazy create threw | `error_kind` |
| `CHAT_TOOL_SELECTED` | `tool_selected` SSE frame | `chat_session_id`, `tool`, `agent_total?` (agents planned for the turn) |
| `CHAT_RESPONSE_COMPLETED` | `done` frame | `chat_session_id`, `tool_used`, `response_type`, `latency_ms`, `first_token_ms`, `response_length`, `source_count`, `image_count`, `has_quiz`, `has_flashcards`, `followup_count`, `tools_used?`, `agent_count?`, `parallel?`, `failed_agents?`, `image_style?` |
| `CHAT_AGENT_COMPLETED` | A generator agent (quiz / flashcards / image) of a multi-agent turn finished or failed (`agent_status` SSE frame) | `chat_session_id`, `tool`, `status: done\|failed`, `ms`, `input: message\|answer`, `agent_total` |
| `CHAT_AGENT_RETRIED` | "Retry" pressed on a failed agent card in the workboard | `chat_session_id`, `tool` (`components/chat/AgentWorkboard.tsx`) |
| `CHAT_RESPONSE_FAILED` | Stream error, or a dropped stream that could not be recovered | `chat_session_id`, `error_kind`, `phase: pre_stream\|mid_stream`, `latency_ms`, `stage?: connect\|waiting\|streaming`, `elapsed_ms?` (ms since the last frame), `trace_id?` |
| `CHAT_RESPONSE_STOPPED` | Stop generating | `chat_session_id`, `elapsed_ms`, `had_content` |
| `CHAT_RESPONSE_RETRIED` | Retry on the error card | `chat_session_id` |
| `CHAT_RESPONSE_RECOVERED` | A stream dropped (no frame for 45 s, or the connection broke mid-turn) and the persisted answer was refetched from the session instead of showing an error | `chat_session_id`, `elapsed_ms`, `attempts` |
| `CHAT_RESPONSE_FEEDBACK` | Thumbs up / down under an answer (`none` = the rating was cleared); stored in `messages.metadata.feedback` via `POST /chat/messages/:id/feedback` | `rating: up\|down\|none`, `tool_used?`, `message_id`, `chat_session_id` (`components/chat/SuggestedActions.tsx`) |
| `CHAT_CLARIFICATION_REQUESTED` | Clarification frame | `chat_session_id`, `question_count` |
| `CHAT_CLARIFICATION_ANSWERED` | Clarification submitted | `action: skip\|answer`, `answered_count` |
| `CHAT_SLASH_COMMAND_SELECTED` | Slash menu pick | `command_id` (`components/chat/ChatComposer.tsx`) |
| `CHAT_VOICE_STARTED` / `CHAT_VOICE_ENDED` / `CHAT_VOICE_FAILED` | Dictation lifecycle | `lang` / `transcript_length`, `canceled`, `duration_ms` / `code`, `transcript_length?` (dictated characters when it failed) (`ChatComposer.tsx`) |
| `CHAT_SUGGESTED_PROMPT_CLICKED` | Starter prompt on the empty chat or the welcome home, or a recommendation. The prompt buttons' click event is the fixed `SUGGESTED_PROMPT_CLICK` (never the prompt text) | `kind: empty_state\|recommendation\|first_conversation\|first_conversation_demo` (`first_conversation` = a chip on Aeva's opening message after onboarding; `first_conversation_demo` = the idle demo auto-sent the first chip, not a tap), `action?` (`components/chat/WelcomeHome.tsx`, `components/chat/EmptyState.tsx`, `components/chat/FirstConversation.tsx`) |
| `CHAT_ACTION_CLICKED` | Action bar under a reply | `action: primary_prompt\|flashcards\|copy\|followup\|save_note\|quiz\|regenerate\|make_notes` (`make_notes` = "Save as revision sheet" / "Important questions", with `action_id: revision_sheet\|important_questions`), `action_id?`, `followup_index?` (`components/chat/SuggestedActions.tsx`) |
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
| `MEDIA_UPLOAD_STARTED` | Per file, after the browser checks and compression pass | `upload_id`, `file_extension`, `mime_type`, `size_bytes` (sent), `original_size_bytes` (picked; equal when nothing was saved), `batch_size`, `chat_session_id`, `is_retry` |
| `MEDIA_UPLOAD_COMPLETED` | Upload HTTP done | `upload_id`, `media_id`, `mime_type`, `size_bytes`, `upload_ms` |
| `MEDIA_UPLOAD_FAILED` | A picked file could not be uploaded. `stage: preflight` failures are caught in the browser and have no `MEDIA_UPLOAD_STARTED` | `upload_id`, `reason: unsupported_type\|too_large\|empty_file\|corrupt_file\|password_protected\|network\|unauthorized\|server_error\|unknown`, `stage: preflight\|upload`, `http_status` (0 = no response), `retryable`, `error_kind`, `file_extension`, `mime_type`, `size_bytes` |
| ★ `MEDIA_PROCESSING_COMPLETED` | Processing reached `ready` | `media_id`, `processing_ms`, `via: stream\|poll`, `stages_seen` |
| `MEDIA_PROCESSING_FAILED` | Processing error frame / poll failure | `media_id`, `stage_last`, `reason: parse_failed\|parse_timeout\|not_found\|unexpected\|unknown` (the backend's `reason` code on the error frame since 2026-10-09, `media_processor.py`; named from the message on older backends and on the status-poll path), `recoverable`, `kept?` (row kept for in-place retry), `processing_ms` |
| `MEDIA_UPLOAD_RETRIED` / `MEDIA_UPLOAD_DISMISSED` | Upload card actions, or the sidebar "Retry" on a failed (not indexed) file | `upload_id`, `mode: resume\|reupload` / `upload_id`, `status` |
| `MEDIA_CONTEXT_TOGGLED` | File (de)selected as chat context | `media_id`, `selected`, `selected_count`, `refused_not_ready` |
| `MEDIA_DELETED` | Sidebar delete | `media_id`, `source` (`chat/MediaSidebar.tsx`) |
| `MEDIA_VIEWER_OPENED` | PDF/image opened | `media_id?`, `source: thumbnail\|citation\|files\|deeplink`, `kind: pdf\|image`, `page?` (`contexts/DocumentViewerContext.tsx`, `pages/FilesPage.tsx`) |
| `MEDIA_VIEWER_CLOSED` | Docked viewer closed | `duration_ms`, `fullscreen_used` (`DocumentViewerContext.tsx`) |

## Quiz

| Event | When | Properties | Hook |
|---|---|---|---|
| `QUIZ_SETUP_REQUESTED` | Setup UI opened by the assistant, `/quiz`, or "Create quiz" on the Quizzes page | `chat_session_id`, `media_available`, `source: assistant\|slash\|quizzes_page`, `entry?: header\|empty_state` | `ChatPage.tsx`, `quiz/CreateQuizPanel.tsx` |
| `QUIZ_GENERATION_REQUESTED` | Setup submitted | `question_count`, `difficulty` (`exam` for exam level), `target_exam?`, `question_types`, `use_media`, `is_exam`, `has_topic`, `has_instructions`, `source: setup\|action\|quizzes_page`, `material?: topic\|files\|note` | `ChatPage.handleGenerateQuiz`, `CreateQuizPanel` |
| `QUIZ_CREATE_FAILED` | Quizzes-page generation failed | `error_kind`, `material` | `CreateQuizPanel` |
| `QUIZ_CARD_VIEWED` | A quiz card in the chat transcript scrolls into view (at least half visible). Once per quiz per page load; with `QUIZ_OPENED` `source: chat_card` it splits "generated but never seen" from "seen but not opened". Added 2026-10-09 | `quiz_id` | `chat/QuizCard.tsx` |
| `QUIZ_OPENED` | Quiz dashboard opened | `quiz_id`, `initial_view`, `source: chat_card\|quizzes_page\|deeplink\|bookmark` | `chat/QuizDrawer.tsx` |
| `QUIZ_STARTED` | Runner mounted (new attempt) | `quiz_id`, `question_count`, `is_exam`, `timer_seconds`, `is_retake`, `is_guest` | `quiz/QuizRunner.tsx` |
| ★ `QUIZ_COMPLETED` | Submit succeeded | `quiz_id`, `attempt_id?`, `time_taken_s`, `auto_submitted`, `answered_count`, `question_count`, `score`, `total`, `correct`, `partial`, `incorrect`, `unanswered`, `final_score?`, `max_marks?`, `is_guest`, `short_answer_count` (written questions in the quiz, 0 for selection-only; added 2026-10-09, absent on older events. With written questions `partial` also counts half-mark written answers and `score` includes their half marks) | `QuizRunner.submit` |
| `QUIZ_SHORT_ANSWER_GRADED` | A fresh attempt's report opens: one event per answered written (`short_answer`) question. Not fired for unanswered ones or when a past attempt is reopened | `quiz_id`, `attempt_id?` (absent for guests), `verdict: correct\|partial\|incorrect`, `score_bucket: 0-24\|25-49\|50-74\|75-100` (share of the rubric covered), `graded_by: llm\|exact_match\|keyword\|unknown` (`keyword` = the model was unavailable and the fallback graded it), `is_guest` | `quiz/QuizAttemptReport.tsx` |
| `QUIZ_SUBMIT_FAILED` | Submit threw | `quiz_id`, `error_kind` | same |
| `QUIZ_ABANDONED` | Left mid-attempt after confirming | `quiz_id`, `elapsed_s` | `QuizDrawer.requestClose` |
| `QUIZ_RETAKEN` | Retake | `quiz_id` | `QuizDrawer.retake` |
| `QUIZ_ATTEMPT_OPENED` | Past attempt opened | `quiz_id`, `attempt_id` | `QuizDrawer` |
| `QUIZ_ANALYSIS_REQUESTED` / `QUIZ_FLASHCARDS_REQUESTED` | Report actions | `quiz_id`, `attempt_id?` | `quiz/QuizAttemptReport.tsx` |
| `QUIZ_QUESTION_VIEWED` | *(defined, not emitted — opt in if needed)* | `quiz_id`, `question_index` | — |
| `QUIZ_FULLSCREEN_TOGGLED` | Desktop "Full screen" button while taking a quiz | `quiz_id`, `enabled` | `QuizDrawer.toggleFullscreen` |
| `QUIZ_EXPORTED` / `QUIZ_SHARED` / `QUIZ_EXAM_CONFIG_UPDATED` | *(defined, not yet emitted)* | see `events.ts` | — |

## Flashcards — `components/chat/FlashcardViewer.tsx`

| Event | When | Properties |
|---|---|---|
| `FLASHCARDS_SETUP_REQUESTED` | Creation panel opened on the Flashcards page | `source: flashcards_page`, `entry: header\|empty_state` (`flashcard/CreateFlashcardsPanel.tsx`) |
| `FLASHCARDS_GENERATION_REQUESTED` | "Create flashcards" from a reply, or the Flashcards-page panel submitted | `chat_session_id`, `source: action\|flashcards_page`, `material?`, `count?`, `has_instructions?` (`ChatPage.tsx`, `CreateFlashcardsPanel`) |
| `FLASHCARDS_CREATE_FAILED` | Flashcards-page generation failed | `error_kind`, `material` (`CreateFlashcardsPanel`) |
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
| `NOTES_GENERATED` ★ | `note_id`, `source: files\|topic\|answer` (what the note was built from: the selected files, the topic and conversation, or the answer its action was tapped on), `length` (characters saved), `kind?: revision_sheet\|formula_sheet\|important_questions\|notes`, `chat_session_id?`. Fired when a chat turn ends with a note written by the notes generator and saved to Notes (typed request or the "Save as revision sheet" / "Important questions" actions) | `pages/ChatPage.tsx` |
| `NOTES_GENERATE_FAILED` | `error_kind: timeout\|generic`, `chat_session_id?`. The notes generator failed or timed out inside a turn that otherwise completed (a turn that fails outright is `CHAT_RESPONSE_FAILED`) | `pages/ChatPage.tsx` |

Printing or exporting a note is counted by the click events `PRINT_CLICK` and
`EXPORT_CLICK` with `location: note_editor` (`page_name: note_detail`); both
buttons on `pages/NoteEditorPage.tsx` carry those fixed names.
| `REVISION_ACTION_CLICKED` | `action: revise\|quiz\|flashcards`, `has_existing_target` | `hooks/useRevisionActions.ts` |
| `CONFIDENCE_SUBMITTED` / `CONFIDENCE_SUBMIT_FAILED` | `confidence`, `source`, `ref_id?` / `source`, `error_kind` | `components/revision/ConfidencePrompt.tsx` |

## Return hook (chat strip) — added 2026-10-09

In-app only: there is no email or push. Off unless the backend runs with
`NOTIFICATIONS_ENABLED=true`. `kind` is what the notification points at:
`plan` (today's exam-plan day), `revision` (topics due), `quiz` (a quiz never
attempted), `flashcards` (a set never studied). Props are counts and enums
only; plan, quiz and set titles are never sent.

| Event | When | Properties | Hook |
|---|---|---|---|
| `NOTIFICATION_STRIP_SHOWN` | The "waiting for you" strip appears at the top of the chat (once per chat mount) | `kind_count`, `has_plan`, `has_revision`, `has_quiz`, `has_flashcards`, `revision_due_count` | `chat/ReturnStrip.tsx` |
| `NOTIFICATION_STRIP_DISMISSED` | The strip's close button; it stays hidden for the rest of the local day (`localStorage.aeva_return_strip_dismissed`) | `kind_count` | `chat/ReturnStrip.tsx` |
| `NOTIFICATION_CLICKED` | A chip on the strip was tapped | `kind: plan\|revision\|quiz\|flashcards`, `source: strip` | `chat/ReturnStrip.tsx` |

The chips and the close button also emit the automatic click events
`RETURN_STRIP_PLAN_CLICK`, `RETURN_STRIP_REVISION_CLICK`,
`RETURN_STRIP_QUIZ_CLICK`, `RETURN_STRIP_FLASHCARDS_CLICK` and
`RETURN_STRIP_DISMISS_CLICK` (explicit `data-analytics-id`, so counts in the
labels never reach an event name). PostHog insight:
[Return hook: notification clicks by kind](https://us.posthog.com/project/629548/insights/0btAXNJx).

## Exam Prep — `pages/exam/*`, `components/exam/*` (feature flag `exam_prep`)

Props carry ids, counts, durations and enums only. The exam name, subjects,
topic titles and syllabus text are user content and are never sent; topic and
subject lists are wrapped in `data-analytics-private` and action buttons carry
a fixed `data-analytics-name`.

| Event | When | Properties | Hook |
|---|---|---|---|
| `EXAM_PREP_CTA_SHOWN` | An Exam Prep call-to-action rendered on the chat home or as the exam-intent banner | `source: empty_state\|welcome\|intent`, `has_plan` | `components/exam/ExamPrepCta.tsx` |
| `EXAM_PREP_CTA_CLICKED` ★ | The CTA or the onboarding celebration button was tapped. The sidebar "Exam Prep" entry is a plain nav click (`sidebar.nav.exam` via `analyticsAttrs`), so `source: sidebar` is declared but not emitted yet | `source: empty_state\|welcome\|intent\|onboarding\|sidebar`, `has_plan` | `ExamPrepCta.tsx`, `learning/OnboardingFlow.tsx` |
| `EXAM_PREP_SETUP_STARTED` | Setup form opened | `prefilled` (profile values pre-filled) | `pages/exam/ExamSetupPage.tsx` |
| `EXAM_PREP_SETUP_STEP_COMPLETED` | A setup step advanced | `step`, `exam_kind?` (school / board / competitive / college / other) | `components/exam/ExamSetupForm.tsx` |
| `EXAM_PREP_SETUP_COMPLETED` ★ | Plan created and roadmap generated | `exam_kind?`, `research?` (official syllabus researched online), `days_remaining`, `subject_count`, `daily_minutes`, `has_target_score`, `has_syllabus`, `material_count`, `total_days`, `latency_ms` | `ExamSetupForm.tsx` |
| `EXAM_PREP_SETUP_FAILED` | Plan creation failed | `error_kind`, `latency_ms`, `step?` (the wizard step it failed on; creation is step 3), `exam_kind?` | same |
| `EXAM_PREP_SETUP_STEP_BLOCKED` | "Continue" was tapped with required fields missing (the form shows what is missing above the button) | `step`, `exam_kind?`, `missing_fields` (field ids: `exam_kind`, `class`, `board`, `stream`, `degree`, `unit_subject`, `exam_name`, `unsupported_exam`, `exam_date`, `exam_date_past`, `subjects`, `daily_minutes`; never their values), `missing_count` | same |
| `EXAM_PREP_OFFER_SHOWN` | The exam-soon card rendered under a chat answer (the message named an exam within a week and the student has no plan). Once per answer per device | `date_hint_kind: today\|tomorrow\|in_days\|weekday\|date` (how the date was stated), `days_until`, `has_exam_name`, `subject_count` | `components/chat/ExamPrepOfferCard.tsx` |
| `EXAM_PREP_OFFER_ACCEPTED` ★ | "Make my plan" tapped with a complete card | `date_hint_kind`, `days_until`, `subject_count`, `date_edited`, `name_edited` (the student changed the prefill) | same |
| `EXAM_PREP_OFFER_DISMISSED` | "Not now" tapped (offers are then hidden for 24 h on that device) | `date_hint_kind`, `days_until` | same |
| `EXAM_PREP_OFFER_PLAN_CREATED` ★ | The plan requested from the card was created | `plan_id`, `days_remaining`, `total_days` (1 = a one-day cram plan), `subject_count`, `research` (false for an exam today or tomorrow), `latency_ms` | same |
| `EXAM_PREP_OFFER_PLAN_FAILED` | Creating the plan from the card failed | `error_kind`, `latency_ms` | same |
| `EXAM_PREP_DASHBOARD_VIEWED` | Exam dashboard rendered with a plan | `plan_id`, `days_remaining`, `progress_percent`, `has_today` | `pages/exam/ExamPrepPage.tsx` |
| `EXAM_PREP_DAY_OPENED` | A day page opened | `plan_id`, `day_id`, `day_number`, `topic_count`, `had_detail` (false = detail generated lazily on this open) | `pages/exam/ExamDayPage.tsx` |
| `EXAM_PREP_DAY_DETAIL_FAILED` | Lazy day-detail generation failed | `plan_id`, `day_id`, `error_kind` | same |
| `EXAM_PREP_TOPIC_OPENED` ★ | A topic page (`/exam/topic/:id`) opened, once the lesson query settled | `plan_id`, `topic_id`, `had_lesson` (false = the lesson is streamed on this open) | `pages/exam/ExamTopicPage.tsx` |
| `EXAM_PREP_LESSON_GENERATED` ★ | Aeva's lesson for a topic finished streaming (first open or Regenerate) | `plan_id`, `topic_id`, `latency_ms`, `lesson_length` (characters) | same |
| `EXAM_PREP_LESSON_FAILED` | The lesson stream failed | `plan_id`, `topic_id`, `error_kind` | same |
| `EXAM_PREP_TOPIC_STATUS_CHANGED` | Topic marked not started / in progress / completed | `plan_id`, `topic_id`, `from`, `to`, `source: row\|sheet\|day\|chat\|topic`, `study_seconds?` (timer reading when completed from the topic page's StudyBar) | `components/exam/useTopicActions.ts` (called from `TopicRow.tsx` / `TopicActionSheet.tsx` / `StudyBar.tsx`) |
| `EXAM_PREP_QUIZ_REQUESTED` / `EXAM_PREP_QUIZ_CREATED` ★ | On-demand topic quiz requested / created | `plan_id`, `topic_id`, `source` / `plan_id`, `topic_id`, `quiz_id`, `latency_ms` | same |
| `EXAM_PREP_FLASHCARDS_REQUESTED` / `EXAM_PREP_FLASHCARDS_CREATED` ★ | On-demand topic flashcards requested / created | `plan_id`, `topic_id`, `source` / `plan_id`, `topic_id`, `set_id`, `latency_ms` | same |
| `EXAM_PREP_GENERATION_FAILED` | Topic quiz / flashcard generation failed | `plan_id`, `topic_id`, `kind: quiz\|flashcards`, `error_kind` | same |
| `EXAM_PREP_CHAT_OPENED` (retired) | No longer emitted: the Ask Aeva drawer (FAB + `ExamChatPanel`) was replaced by the topic page. The enum member stays so old events keep their type. The PostHog insight "Exam Prep — daily engagement" counted this event; it should read `EXAM_PREP_TOPIC_OPENED` instead | `plan_id`, `has_topic`, `has_day`, `source: fab\|topic\|learn` | — |
| `EXAM_PREP_MESSAGE_SENT` ★ | Message sent to the Exam Prep coach from a topic page's doubt box (`has_topic` / `has_day` are always true there; `intent: learn` is no longer emitted) | `plan_id`, `message_length`, `has_topic`, `has_day`, `intent: text\|quiz\|flashcards\|followup\|learn`, `media_count` (uploads sent as context; added with the topic-page context panel) | `components/exam/useExamConversation.ts` |
| `EXAM_PREP_CONTEXT_MEDIA_TOGGLED` | An upload was selected or deselected as coach context in the topic page's "Answering from" panel (plan material is selected by default) | `plan_id`, `selected`, `selected_count`, `source: plan\|other` (whether the file was chosen at plan setup) | `components/exam/useExamContextMedia.ts` |
| `EXAM_PREP_RESPONSE_COMPLETED` | Exam chat turn finished | `plan_id`, `tool_used?`, `latency_ms`, `first_token_ms`, `response_length`, `has_quiz`, `has_flashcards` | same |
| `EXAM_PREP_RESPONSE_FAILED` | Exam chat turn failed | `plan_id`, `phase: pre_stream\|mid_stream`, `error_kind` | same |
| `EXAM_PREP_PLAN_ARCHIVED` | Plan archived ("Start over") | `plan_id`, `days_remaining`, `progress_percent` | `pages/exam/ExamPrepPage.tsx` |
| `EXAM_PREP_NEXT_UP_CLICKED` ★ | The "Start" / "Continue" button of the dashboard's Next up card, the day page's "Start day" / "Continue day", or "Start next topic" in the sheet shown after completing a topic | `plan_id`, `topic_id`, `source: dashboard\|day\|sheet` | `components/exam/NextUpCard.tsx`, `pages/exam/ExamDayPage.tsx`, `components/exam/NextUpSheet.tsx` |
| `EXAM_PREP_TIMER_TOGGLED` | The study timer on the topic page was started, paused, resumed or reset by the student (the auto-start on open is not tracked) | `plan_id`, `topic_id`, `action: start\|pause\|resume\|reset`, `elapsed_s` | `components/exam/StudyBar.tsx` |

Quizzes and flashcard sets opened from Exam Prep reuse `QuizDrawer` /
`FlashcardViewer`, so the existing `QUIZ_*` and `FLASHCARDS_*` events keep
firing there with `source: "exam_prep"`. Page views arrive as `PAGE_ENTRY`
with `page_name: exam | exam_setup | exam_day | exam_topic`.
The "How it works" strip on the dashboard (shown until the first topic is
completed) is dismissed with a plain click (`Exam how it works dismiss`); the
checklist rows (`Exam today step`), the StudyBar buttons (`Exam study …`) and
the next-up sheet buttons are plain clicks too.

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
