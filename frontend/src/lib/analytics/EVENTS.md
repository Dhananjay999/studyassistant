# Event catalogue

Wire names are lowercase snake_case. Every event automatically carries the
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
| `session_started` | First event of a new analytics session | `entry_page`, `referrer_domain?`, `utm_source?`, `utm_medium?`, `utm_campaign?`, `is_new_visitor` | `service.ts` via `session.ts` |
| `session_ended` | Lazily, when the previous session is found expired, or on logout | `duration_s`, `event_count`, `exit_page?`, `reason: timeout\|logout` | `service.ts` |
| `page_entry` | Route pathname changed (or first load) | `page_path`, `page_name`, `previous_path`, `entry_source: initial\|navigation\|back_forward`, `qp_session_id?`, `qp_quiz_id?`, `qp_set_id?`, `qp_file_id?`, `qp_auth_error?` | `hooks/useAnalyticsRouteTracker.ts` |
| `page_exit` | Leaving a route, or tab hidden / pagehide | `page_path`, `page_name`, `time_on_page_s`, `exit_type: navigation\|hidden` | same |
| `click` | Click on any element with `data-analytics-id` | `element_id`, `element_name?`, `element_type`, `location?`, `href?` | `clicks.ts` |

Click ids in use: `landing.nav.<slug>`, `landing.hero.explore_features`,
`sidebar.nav.<route>`.

## Auth / landing

| Event | When | Properties | Hook |
|---|---|---|---|
| ★ `landing_cta_clicked` | Google CTA pressed | `location: hero\|navbar\|navbar_mobile\|cta_band\|features\|about\|app_welcome\|share` | `landing/GoogleButton.tsx`, `pages/AppWelcomePage.tsx` |
| `landing_faq_opened` | FAQ accordion item opened | `faq_index` | `landing/Faq.tsx` |
| ★ `login_started` | Popup opened or redirect started | `method: popup\|redirect` | `contexts/AuthContext.tsx signInWithGoogle` |
| `login_abandoned` | Popup closed without tokens | — | same (popup poll) |
| `login_failed` | Callback had no tokens / session failed | `reason: missing_token\|session` | `pages/AuthCallback.tsx` |
| ★ `login_succeeded` | Tokens received and profile loaded | `method`, `is_new_user` | `AuthContext.loadUser("login")` |
| `logout_completed` | User confirmed logout | `source: header\|settings_modal\|settings_mobile\|settings_account\|profile_page` | `hooks/useConfirmLogout.ts` |
| `session_invalidated` | 401 / failed refresh forced a logout | — | `AuthContext.onSessionInvalid` |

`identify(user)` runs in `AuthContext.loadUser` (login, boot restore, refresh);
`reset()` runs first thing in `hardLogout`.

## Onboarding — `components/learning/OnboardingFlow.tsx`

| Event | When | Properties |
|---|---|---|
| `onboarding_started` | Welcome "Start" (first run) or edit dialog opened | `mode: first_run\|edit` |
| `onboarding_step_completed` | A step advanced (answered or skipped) | `step`, `step_index`, `skipped`, `selection_count?` |
| ★ `onboarding_completed` | Profile saved from the wizard | `steps_answered`, `has_exam_target`, `subject_count` |
| ★ `onboarding_skipped` | Skip-all button or dialog dismissed | `at_step_index` (−1 on the intro), `via: button\|dismiss` |
| `onboarding_save_failed` | Save rejected | `error_kind` |

## Chat — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| ★ `chat_message_sent` | `send()` passed its guards | `chat_session_id`, `is_new_session`, `message_length`, `media_count`, `intent: text\|clarification\|quiz\|flashcards\|source_seed\|followup`, `source: composer\|suggested_prompt\|followup\|slash\|seed\|revision\|action`, `voice_used`, `has_seed_context` |
| `chat_session_created` | A chat session row was created | `chat_session_id`, `space_id`, `trigger: first_message\|revision\|space\|note\|flashcard_resume\|bookmark_resume\|quiz_report_flashcards` (also `useRevisionActions`, `SpaceWorkspacePage`, `NoteEditorPage`, `FlashcardViewer`, `BookmarkDetailPage`, `QuizAttemptReport`) |
| `chat_session_create_failed` | Lazy create threw | `error_kind` |
| `chat_tool_selected` | `tool_selected` SSE frame | `chat_session_id`, `tool` |
| `chat_response_completed` | `done` frame | `chat_session_id`, `tool_used`, `response_type`, `latency_ms`, `first_token_ms`, `response_length`, `source_count`, `image_count`, `has_quiz`, `has_flashcards`, `followup_count` |
| `chat_response_failed` | Stream error | `chat_session_id`, `error_kind`, `phase: pre_stream\|mid_stream`, `latency_ms` |
| `chat_response_stopped` | Stop generating | `chat_session_id`, `elapsed_ms`, `had_content` |
| `chat_response_retried` | Retry on the error card | `chat_session_id` |
| `chat_clarification_requested` | Clarification frame | `chat_session_id`, `question_count` |
| `chat_clarification_answered` | Clarification submitted | `action: skip\|answer`, `answered_count` |
| `chat_slash_command_selected` | Slash menu pick | `command_id` (`components/chat/ChatComposer.tsx`) |
| `chat_voice_started` / `chat_voice_ended` / `chat_voice_failed` | Dictation lifecycle | `lang` / `transcript_length`, `canceled`, `duration_ms` / `code` (`ChatComposer.tsx`) |
| `chat_suggested_prompt_clicked` | Welcome prompt or recommendation | `kind: empty_state\|recommendation`, `action?` (`components/chat/WelcomeHome.tsx`) |
| `chat_action_clicked` | Action bar under a reply | `action: primary_prompt\|flashcards\|copy\|followup\|save_note`, `action_id?`, `followup_index?` (`components/chat/SuggestedActions.tsx`) |
| `chat_note_saved` / `chat_note_save_failed` | Save reply as note | `note_id`, `chat_session_id`, `content_length` / `error_kind` |
| `chat_source_clicked` | Web source card, document chip or inline citation | `kind: web\|document`, `media_id?`, `page?`, `position?` (`SourceCards.tsx`, `MarkdownContent.tsx`) |
| `chat_session_opened` | Session chosen in sidebar / palette | `chat_session_id`, `source: sidebar\|palette` (`layout/AppLayout.tsx`) |
| `chat_session_deleted` | Sidebar delete | `chat_session_id`, `was_active` (`AppLayout.tsx`) |
| `chat_session_pinned` | Pin / unpin | `chat_session_id`, `pinned` (`chat/AppSidebar.tsx`) |
| `chat_new_started` | New chat | `source: sidebar\|shortcut\|palette\|header` (`AppLayout.tsx`, `ChatPage.tsx`) |

## Media — `pages/ChatPage.tsx` unless noted

| Event | When | Properties |
|---|---|---|
| `media_upload_started` | Per file, after client compression | `upload_id`, `file_extension`, `mime_type`, `size_bytes`, `batch_size`, `chat_session_id`, `is_retry` |
| `media_upload_completed` | Upload HTTP done | `upload_id`, `media_id`, `mime_type`, `size_bytes`, `upload_ms` |
| `media_upload_failed` | Upload threw | `upload_id`, `error_kind`, `mime_type`, `size_bytes` |
| ★ `media_processing_completed` | Processing reached `ready` | `media_id`, `processing_ms`, `via: stream\|poll`, `stages_seen` |
| `media_processing_failed` | Processing error frame / poll failure | `media_id`, `stage_last`, `recoverable`, `processing_ms` |
| `media_upload_retried` / `media_upload_dismissed` | Upload card actions | `upload_id`, `mode: resume\|reupload` / `upload_id`, `status` |
| `media_context_toggled` | File (de)selected as chat context | `media_id`, `selected`, `selected_count`, `refused_not_ready` |
| `media_deleted` | Sidebar delete | `media_id`, `source` (`chat/MediaSidebar.tsx`) |
| `media_viewer_opened` | PDF/image opened | `media_id?`, `source: thumbnail\|citation\|files\|deeplink`, `kind: pdf\|image`, `page?` (`contexts/DocumentViewerContext.tsx`, `pages/FilesPage.tsx`) |
| `media_viewer_closed` | Docked viewer closed | `duration_ms`, `fullscreen_used` (`DocumentViewerContext.tsx`) |

## Quiz

| Event | When | Properties | Hook |
|---|---|---|---|
| `quiz_setup_requested` | Setup UI opened by the assistant or `/quiz` | `chat_session_id`, `media_available`, `source: assistant\|slash` | `ChatPage.tsx` |
| `quiz_generation_requested` | Setup submitted | `question_count`, `difficulty`, `question_types`, `use_media`, `is_exam`, `has_topic`, `has_instructions`, `source: setup\|action` | `ChatPage.handleGenerateQuiz` |
| `quiz_opened` | Quiz dashboard opened | `quiz_id`, `initial_view`, `source: chat_card\|quizzes_page\|deeplink\|bookmark` | `chat/QuizDrawer.tsx` |
| `quiz_started` | Runner mounted (new attempt) | `quiz_id`, `question_count`, `is_exam`, `timer_seconds`, `is_retake`, `is_guest` | `quiz/QuizRunner.tsx` |
| ★ `quiz_completed` | Submit succeeded | `quiz_id`, `attempt_id?`, `time_taken_s`, `auto_submitted`, `answered_count`, `question_count`, `score`, `total`, `correct`, `partial`, `incorrect`, `unanswered`, `final_score?`, `max_marks?`, `is_guest` | `QuizRunner.submit` |
| `quiz_submit_failed` | Submit threw | `quiz_id`, `error_kind` | same |
| `quiz_abandoned` | Left mid-attempt after confirming | `quiz_id`, `elapsed_s` | `QuizDrawer.requestClose` |
| `quiz_retaken` | Retake | `quiz_id` | `QuizDrawer.retake` |
| `quiz_attempt_opened` | Past attempt opened | `quiz_id`, `attempt_id` | `QuizDrawer` |
| `quiz_analysis_requested` / `quiz_flashcards_requested` | Report actions | `quiz_id`, `attempt_id?` | `quiz/QuizAttemptReport.tsx` |
| `quiz_question_viewed` | *(defined, not emitted — opt in if needed)* | `quiz_id`, `question_index` | — |
| `quiz_exported` / `quiz_shared` / `quiz_exam_config_updated` | *(defined, not yet emitted)* | see `events.ts` | — |

## Flashcards — `components/chat/FlashcardViewer.tsx`

| Event | When | Properties |
|---|---|---|
| `flashcards_generation_requested` | "Create flashcards" from a reply | `chat_session_id`, `source` (`ChatPage.tsx`) |
| `flashcards_study_started` | Set opened and loaded | `set_id`, `card_count`, `source: chat\|flashcards_page\|deeplink\|bookmark` |
| `flashcards_study_completed` | Last card finished | `set_id`, `card_count`, `duration_s`, `rated_count`, `easy`, `medium`, `hard`, `needs_revision`, `flip_count`, `shuffled`, `review_again` |
| `flashcards_study_abandoned` | Viewer closed with unsaved ratings | `set_id`, `rated_count`, `index` |
| `flashcards_resumed_in_chat` | Continue in chat | `set_id`, `mode` |

## Search — `components/GlobalCommandPalette.tsx`, `layout/AppLayout.tsx`

| Event | When | Properties |
|---|---|---|
| `search_opened` | Palette opened | `source: shortcut\|sidebar\|header` |
| `search_performed` | Once per settled (debounced, loaded) query | `scope: global`, `query_length`, `result_count`, `has_results`, `group_counts` |
| `search_result_clicked` | Result chosen | `scope`, `group`, `query_length` |
| `search_action_clicked` | Quick action chosen | `action: new_chat\|revision\|bookmarks\|theme` |

## Bookmarks — `components/BookmarkButton.tsx`, `pages/BookmarksPage.tsx`, `pages/BookmarkDetailPage.tsx`

| Event | Properties |
|---|---|
| `bookmark_created` / `bookmark_create_failed` | `item_type`, `collection_id`, `new_collection` / `item_type`, `error_kind` |
| `bookmark_removed` | `bookmark_id?`, `item_type?`, `source: button\|page`, `bulk_count?` |
| `bookmark_opened` | `bookmark_id`, `item_type` |
| `bookmark_resumed_in_chat` | `bookmark_id`, `mode`, `source: list\|detail` |
| `bookmark_moved` | `count`, `to_collection_id` |
| `collection_created` / `collection_renamed` / `collection_deleted` | `collection_id` |

## Spaces / notes / revision

| Event | Properties | Hook |
|---|---|---|
| `space_created` / `space_updated` / `space_deleted` | `space_id`, `mode?` | `pages/SpacesPage.tsx`, `pages/SpaceWorkspacePage.tsx` |
| `space_opened` | `space_id` | `SpaceWorkspacePage.tsx` |
| `space_converted_from_chat` | `space_id`, `chat_session_id` | `chat/AppSidebar.tsx` |
| `note_created` / `note_updated` / `note_deleted` | `note_id`, `content_length` | `pages/NotesPage.tsx`, `pages/NoteEditorPage.tsx` |
| `note_asked_in_chat` | `note_id`, `mode` | `NoteEditorPage.tsx` |
| `revision_action_clicked` | `action: revise\|quiz\|flashcards`, `has_existing_target` | `hooks/useRevisionActions.ts` |
| `confidence_submitted` / `confidence_submit_failed` | `confidence`, `source`, `ref_id?` / `source`, `error_kind` | `components/revision/ConfidencePrompt.tsx` |

## Sharing (public, anonymous) — `pages/SharePage.tsx`

| Event | Properties |
|---|---|
| `share_viewed` | `share_id`, `kind` |
| `share_resolve_failed` | `share_id`, `kind` |

Guest quiz attempts on share pages emit `quiz_started` / `quiz_completed` with
`is_guest: true`.

## Settings / profile

| Event | Properties | Hook |
|---|---|---|
| `settings_opened` | `section` | `contexts/SettingsContext.tsx` |
| `settings_section_viewed` | `section` | same |
| `preference_changed` | `key: color_theme\|custom_accent\|font_size\|content_font\|reduce_motion\|compact\|voice_lang\|theme_mode`, `value` | `contexts/PreferencesContext.tsx`, `components/ThemeToggle.tsx` |
| `preferences_reset` | — | `PreferencesContext.tsx` |
| `learning_profile_edit_started` / `learning_profile_saved` / `learning_profile_reset` | — / `fields_set` / — | `settings/sections/LearningProfileSection.tsx`, `OnboardingFlow.tsx` (edit mode) |

## Errors

| Event | When | Properties | Hook |
|---|---|---|---|
| `api_error` | Any non-2xx / timeout / network failure in the API client (refresh calls excluded, 401 bursts deduped) | `method`, `endpoint` (ids → `:id`), `status` (0 = no response), `error_kind`, `timeout` | `lib/api.ts request()` |

Unhandled runtime exceptions are captured by PostHog's exception autocapture
(`capture_exceptions: true`), not by a custom event. Web vitals come from
PostHog's autocapture and Vercel Analytics.
