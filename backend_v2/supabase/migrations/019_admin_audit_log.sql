-- Admin audit log: every sensitive Super Admin action (profile edits, user /
-- data deletions, debug-user toggles) is recorded with who did it, to whom,
-- and what resource was touched. Insert-only from the service role; nothing
-- in the app ever updates or deletes rows.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Admin username from the admin JWT (env-credential identity).
    admin_username TEXT NOT NULL,
    -- Machine-readable action key, e.g. 'profile.edit', 'user.delete',
    -- 'debug_user.enable', 'resource.delete'.
    action TEXT NOT NULL,
    -- The affected end user (nullable: some actions are global).
    user_id UUID,
    -- Affected resource, e.g. 'quiz:<id>', 'session:<id>', 'profile'.
    resource TEXT,
    -- Free-form context (changed fields, counts, mode flags, …).
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created
    ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user
    ON admin_audit_log(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
