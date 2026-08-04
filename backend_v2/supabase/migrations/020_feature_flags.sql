-- Global feature flags: admin-controlled kill switches for optional features
-- (image generation, revision mode, study spaces, notes, analytics, web
-- search, sharing). The flag REGISTRY (keys, labels, descriptions, defaults)
-- lives in backend code (aeva/feature_flag/feature_flag_service.py); this
-- table stores only OVERRIDES. A missing row means "use the code default"
-- (enabled), so shipping this migration changes nothing until an admin flips
-- a switch. Rows are upserted lazily on the first admin toggle — no seed
-- data, so registry and DB can never drift. Backward compatible: additive.

CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the backend's service-role client touches this table (it bypasses
-- RLS). Enabling RLS with no policies blocks anon/authenticated access
-- entirely — defence in depth, same pattern as prior migrations.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
