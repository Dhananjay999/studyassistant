-- Media OCR fallback: remember which parse tier produced a document's text.
--
-- The processor parses at the cheap text-layer tier first and, when the
-- result is glyph junk (symbol-font PDFs such as NCERT books) or blank (a
-- scan), re-parses at the OCR tier. The tier is stored so a resumed run
-- knows the stored job is already the OCR one and never loops, and so admin
-- can see which files needed OCR.
--
-- Additive, nullable, no default: no table rewrite and no lock beyond the
-- instant catalog change. Safe to apply inside a transaction.

ALTER TABLE media ADD COLUMN IF NOT EXISTS parse_tier TEXT;

COMMENT ON COLUMN media.parse_tier IS
    'LlamaParse tier that produced the stored parse (fast, agentic, ...).';
