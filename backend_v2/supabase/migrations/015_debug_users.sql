-- Developer Mode: per-user debug flag, managed from the Super Admin panel.
-- Debug users see internal diagnostics (model, tool, timings) in the app;
-- normal users never do. Independent of any role — any account can be
-- toggled on temporarily for testing.

alter table public.profiles
  add column if not exists is_debug_user boolean not null default false;

-- The admin panel lists active debug users; keep that lookup cheap.
create index if not exists idx_profiles_is_debug_user
  on public.profiles (is_debug_user)
  where is_debug_user;
