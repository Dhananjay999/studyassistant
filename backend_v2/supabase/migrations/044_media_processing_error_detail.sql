-- Upload failure diagnostics (2026-10-31).
--
-- Between 2026-10-22 and 2026-10-24 eight uploads failed with the constant
-- message "Processing failed unexpectedly." and nothing else: the exception
-- class, message and failing stage were never stored, and the Sentry events
-- were dropped as oversized. `processing_error` stays the student-facing
-- message; these two columns carry what engineering needs.
--
--   processing_error_detail  "ClassName: message" (bounded to 400 chars)
--   processing_error_stage   last stage announced before the failure
--                            (start | parsing | extracting | chunking |
--                             embedding | indexing)
--
-- Both nullable, no default, no backfill: ADD COLUMN is a catalogue-only
-- change on PostgreSQL (no table rewrite, brief ACCESS EXCLUSIVE lock).
-- No index: the columns are read per row from the admin media view, never
-- filtered on. Expected growth: one row per upload, as today.
--
-- Rollback:
--   ALTER TABLE public.media
--       DROP COLUMN IF EXISTS processing_error_detail,
--       DROP COLUMN IF EXISTS processing_error_stage;

ALTER TABLE public.media
    ADD COLUMN IF NOT EXISTS processing_error_detail TEXT,
    ADD COLUMN IF NOT EXISTS processing_error_stage TEXT;
