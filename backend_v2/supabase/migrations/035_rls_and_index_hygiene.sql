-- Database hygiene from the Supabase advisors (product-intelligence R24,
-- advisors run 2026-10-09): nothing here changes what any user can see or
-- do; it makes the existing rules cheaper at scale and closes an anonymous
-- RPC surface.
--
--   A. 48 RLS policies re-evaluated auth.uid() for every row
--      (auth_rls_initplan). Wrapping it as (select auth.uid()) makes the
--      planner evaluate it once per statement (InitPlan). Same predicate,
--      same index use (user_id / owner_user_id / id), same semantics.
--   B. 3 SECURITY DEFINER trigger functions (handle_new_user,
--      rls_auto_enable, update_session_timestamp) were callable by anon and
--      authenticated through /rest/v1/rpc/. They are trigger bodies, never
--      called by the app, so EXECUTE is revoked from PUBLIC/anon/
--      authenticated. Triggers still fire (they run as the table owner).
--   C. 8 functions had a role-mutable search_path; pinned to
--      "public, pg_temp" (every body references public tables and the
--      pgvector operators that live in public). rls_auto_enable already
--      had one and is left as is.
--   D. 5 foreign keys had no covering index (ON DELETE CASCADE / SET NULL on
--      the parent scans the child table without one). Added in PART 2.
--
-- Not changed, on purpose:
--   * The 11 tables with RLS on and no policy (ai_traces, ai_trace_spans,
--     ai_prompt_versions, admin_audit_log, feature_flags, exam_plans,
--     exam_plan_days, exam_plan_topics, notes, study_spaces,
--     profiles_learning_backup_025): every read and write goes through the
--     backend with the service-role key (which bypasses RLS); the frontend
--     has no supabase-js client (package.json). "RLS on, no policy" is
--     therefore deny-all for anon/authenticated, which is the intended
--     state. Adding user policies would widen access, not narrow it. If a
--     direct client is ever added, start with the exam_plan*/notes/
--     study_spaces tables (all keyed by user_id) using the same
--     (select auth.uid()) = user_id pattern as below.
--   * The 14 "unused" indexes: idx_*_search back the global search feature
--     (search_all), which is opened but has not had a settled query in the
--     window (R25 keeps Search); idx_ai_traces_* serve the admin trace
--     explorer; idx_media_chunks_embedding is the HNSW index the exact-scan
--     rule skips under 5 000 chunks. Re-check after 90 days of traffic.
--   * vector extension in public and leaked-password protection: dashboard
--     settings, not migrations.
--
-- HOW TO APPLY: PART 1 is plain transactional DDL (one statement batch).
-- PART 2 must be run AFTER it, each statement on its own, OUTSIDE a
-- transaction block, exactly like 028/031 (CREATE INDEX CONCURRENTLY is
-- rejected inside BEGIN/COMMIT and tools that wrap a file in one implicit
-- transaction would roll the whole batch back). If a concurrent build is
-- interrupted it is left INVALID and IF NOT EXISTS then skips it; check with
-- `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` and
-- `DROP INDEX CONCURRENTLY IF EXISTS <name>;` before re-running.
--
-- Expected effect at millions of rows: a per-user list query goes from one
-- auth.uid() call per candidate row to one per statement; the FK indexes
-- turn parent deletes from a sequential scan of the child table into an
-- index lookup. Verify with EXPLAIN (ANALYZE) on e.g.
--   SELECT * FROM bookmarks WHERE user_id = '<uid>' ORDER BY created_at DESC;
-- which should show "InitPlan 1 (returns $0)" and an index scan.

-- ===========================================================================
-- PART 1 - transactional DDL
-- ===========================================================================

-- A. RLS policies: evaluate auth.uid() once per statement.
ALTER POLICY "Users can delete own collections" ON public.bookmark_collections
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own collections" ON public.bookmark_collections
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own collections" ON public.bookmark_collections
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own collections" ON public.bookmark_collections
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own bookmarks" ON public.bookmarks
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own bookmarks" ON public.bookmarks
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own bookmarks" ON public.bookmarks
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own bookmarks" ON public.bookmarks
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own flashcard sets" ON public.flashcard_sets
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own flashcard sets" ON public.flashcard_sets
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own flashcard sets" ON public.flashcard_sets
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own study" ON public.flashcard_study
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own study" ON public.flashcard_study
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own study" ON public.flashcard_study
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert cards in own sets" ON public.flashcards
    WITH CHECK (EXISTS ( SELECT 1 FROM flashcard_sets s WHERE ((s.id = flashcards.set_id) AND (s.user_id = (select auth.uid())))));
ALTER POLICY "Users can view cards in own sets" ON public.flashcards
    USING (EXISTS ( SELECT 1 FROM flashcard_sets s WHERE ((s.id = flashcards.set_id) AND (s.user_id = (select auth.uid())))));
ALTER POLICY "Users can delete own media" ON public.media
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own media" ON public.media
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own media" ON public.media
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own media chunks" ON public.media_chunks
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own media chunks" ON public.media_chunks
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own media chunks" ON public.media_chunks
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own media pages" ON public.media_pages
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own media pages" ON public.media_pages
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own media pages" ON public.media_pages
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert messages in own sessions" ON public.messages
    WITH CHECK (EXISTS ( SELECT 1 FROM sessions s WHERE ((s.id = messages.session_id) AND (s.user_id = (select auth.uid())))));
ALTER POLICY "Users can view messages in own sessions" ON public.messages
    USING (EXISTS ( SELECT 1 FROM sessions s WHERE ((s.id = messages.session_id) AND (s.user_id = (select auth.uid())))));
ALTER POLICY "Users can insert own orchestration runs" ON public.orchestration_runs
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own orchestration runs" ON public.orchestration_runs
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own orchestration runs" ON public.orchestration_runs
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own profile" ON public.profiles
    USING ((select auth.uid()) = id);
ALTER POLICY "Users can view own profile" ON public.profiles
    USING ((select auth.uid()) = id);
ALTER POLICY "Users can insert own quiz attempts" ON public.quiz_attempts
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own quiz attempts" ON public.quiz_attempts
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert questions in own quizzes" ON public.quiz_questions
    WITH CHECK (EXISTS ( SELECT 1 FROM quizzes q WHERE ((q.id = quiz_questions.quiz_id) AND (q.user_id = (select auth.uid())))));
ALTER POLICY "Users can view questions in own quizzes" ON public.quiz_questions
    USING (EXISTS ( SELECT 1 FROM quizzes q WHERE ((q.id = quiz_questions.quiz_id) AND (q.user_id = (select auth.uid())))));
ALTER POLICY "Users can insert own quizzes" ON public.quizzes
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own quizzes" ON public.quizzes
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can manage own revision events" ON public.revision_events
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can manage own revision items" ON public.revision_items
    USING ((select auth.uid()) = user_id)
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can delete own sessions" ON public.sessions
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can insert own sessions" ON public.sessions
    WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users can update own sessions" ON public.sessions
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Users can view own sessions" ON public.sessions
    USING ((select auth.uid()) = user_id);
ALTER POLICY "Owners can view guest attempts on their shares" ON public.share_attempts
    USING (EXISTS ( SELECT 1 FROM shares s WHERE ((s.id = share_attempts.share_id) AND (s.owner_user_id = (select auth.uid())))));
ALTER POLICY "Users can insert own shares" ON public.shares
    WITH CHECK ((select auth.uid()) = owner_user_id);
ALTER POLICY "Users can update own shares" ON public.shares
    USING ((select auth.uid()) = owner_user_id);
ALTER POLICY "Users can view own shares" ON public.shares
    USING ((select auth.uid()) = owner_user_id);

-- B. Trigger functions are not an API. (Default EXECUTE goes to PUBLIC,
--    which anon/authenticated inherit, so all three must be revoked.)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_session_timestamp() FROM PUBLIC, anon, authenticated;

-- C. Pin search_path so a caller's role setting cannot redirect the lookups.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_session_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_share_metric(uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.search_all(uuid, text, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.ai_prompt_usage(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_ai_traces(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.match_media_chunks(vector, uuid, uuid[], integer)
    SET search_path = public, pg_temp;
ALTER FUNCTION public.search_media_chunks(
    vector, uuid, uuid[], text, integer, integer, integer, integer, integer, integer
) SET search_path = public, pg_temp;

-- ===========================================================================
-- PART 2 - run each statement on its own, outside a transaction (see header)
-- ===========================================================================

-- D. Covering indexes for the unindexed foreign keys. Partial where the
--    column is nullable and mostly NULL, so the index stays small; the FK
--    check and ON DELETE actions only ever look up non-NULL values.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookmarks_collection
    ON public.bookmarks(collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flashcard_sets_session
    ON public.flashcard_sets(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flashcard_study_flashcard
    ON public.flashcard_study(flashcard_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_pages_user
    ON public.media_pages(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revision_items_space
    ON public.revision_items(space_id) WHERE space_id IS NOT NULL;
