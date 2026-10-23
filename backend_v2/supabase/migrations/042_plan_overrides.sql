-- Plan catalog overrides: admin-managed pricing (2026-10-23).
--
-- The plan catalog (tiers, regional prices, today's price, Early Access
-- flag) is REGISTERED in backend code (aeva/plan/plan_service.py); this
-- table stores only OVERRIDES, one row per plan key, written from the admin
-- panel ("Plans & Pricing"). A missing row means "use the code default", so
-- shipping this migration changes nothing until an admin saves a price.
-- Same model as feature_flags (020): registry in code, overrides in the DB,
-- read through a 60 s per-process cache on /config and the product-info
-- prompt, fail-open to the code defaults.
--
-- `value` is the whole override document, validated by the admin schema:
--   {"prices": [{"interval": "month", "currency": "INR", "amount": 99}, ...],
--    "current_amount": 0, "early_access": true}
--
-- Expected growth: one row per plan (two today). Read by primary key only,
-- so no further index. Service-role access only: RLS on with no policies.
--
-- Rollback: DROP TABLE public.plan_overrides;

CREATE TABLE IF NOT EXISTS public.plan_overrides (
    plan_key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.plan_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.plan_overrides IS
    'Admin overrides of the code-registered plan catalog (aeva/plan). One row per plan key; missing row = code default.';
