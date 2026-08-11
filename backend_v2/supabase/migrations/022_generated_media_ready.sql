-- Aeva-generated images never enter the parse pipeline, so rows created
-- before the fix sit at processing_status='pending' forever — showing an
-- endless "processing" spinner and refusing to open from Study Material.
-- New generated rows are inserted as 'ready' by the backend; this repairs
-- the existing ones. Generated images are identifiable by their storage
-- prefix ({user_id}/generated/{uuid}). Idempotent and additive.

UPDATE media
SET processing_status = 'ready'
WHERE storage_path LIKE '%/generated/%'
  AND processing_status = 'pending';
