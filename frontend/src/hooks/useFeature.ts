// Gate primitive for admin-managed global feature flags (delivered on
// GET /config). Fails OPEN: every registry default is enabled, so rendering
// while /config loads (or fails) matches the common case and avoids nav
// layout pop — a briefly-visible disabled feature self-corrects as soon as
// the config lands.

import { useAppConfig } from "@/hooks/api";
import { useAuth } from "@/contexts/AuthContext";
import type { AppConfig, FeatureKey, User } from "@/types";

/**
 * Whether `key` is kept off for this account because it is a new user:
 * /config lists the flags hidden for accounts created on/after a date
 * (`features_new_users`, see aeva.feature_flag), and the signed-in profile
 * carries its `created_at`. Anonymous visitors and accounts older than the
 * date are never affected, so nothing changes for existing users.
 */
export function hiddenForNewUser(
  key: FeatureKey,
  config: AppConfig | undefined,
  user: Pick<User, "created_at"> | null | undefined,
): boolean {
  const rule = config?.features_new_users;
  const created = user?.created_at;
  if (!rule || !created || !rule.hidden?.includes(key)) return false;
  const createdAt = Date.parse(created);
  const since = Date.parse(rule.since);
  if (Number.isNaN(createdAt) || Number.isNaN(since)) return false;
  return createdAt >= since;
}

/**
 * True unless the admin has explicitly disabled the feature, or the feature
 * is hidden for new users and this account is one (`hiddenForNewUser`).
 *
 * `fallback` is what the hook returns while /config is loading, failed, or
 * comes from a backend that does not know the key. It defaults to `true`
 * (fail open) for the long-standing flags; a feature that ships disabled by
 * default (e.g. `exam_prep`) passes `false` so it never flashes on.
 */
export function useFeature(key: FeatureKey, fallback = true): boolean {
  const { data } = useAppConfig();
  const { user } = useAuth();
  if (hiddenForNewUser(key, data, user)) return false;
  return data?.features?.[key] ?? fallback;
}
