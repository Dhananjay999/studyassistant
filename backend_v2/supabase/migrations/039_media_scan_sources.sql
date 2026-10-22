-- Photo batches as one searchable document (product-intelligence 3.2,
-- 2026-10-16).
--
-- 256 of 354 ready uploads are photos of notes and textbook pages, and none
-- of them is indexed: an image is attached whole to the model and cannot be
-- searched, quizzed or cited. A "scan" is a plain-text media row built by
-- OCR-ing a batch of the student's photos in order (aeva/media/
-- media_processor.py, _run_scan); `scan_source_ids` remembers which photos
-- it came from so the processing stream can (re)build it.
--
-- One change, metadata-only (no table rewrite): a nullable UUID[] column
-- with no default. Every existing row reads NULL. No index: the column is
-- never filtered or joined on (the scan is reached by its own id). Expected
-- growth: one row per scan, at most a few per uploader per week; the photos
-- themselves stay as they are.
--
-- Rollback: ALTER TABLE public.media DROP COLUMN scan_source_ids;

ALTER TABLE public.media
    ADD COLUMN IF NOT EXISTS scan_source_ids UUID[];

COMMENT ON COLUMN public.media.scan_source_ids IS
    'Photo media ids this text document was OCR-ed from, in page order (NULL for ordinary uploads).';
