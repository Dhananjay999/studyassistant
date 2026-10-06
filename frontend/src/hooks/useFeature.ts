// Gate primitive for admin-managed global feature flags (delivered on
// GET /config). Fails OPEN: every registry default is enabled, so rendering
// while /config loads (or fails) matches the common case and avoids nav
// layout pop — a briefly-visible disabled feature self-corrects as soon as
// the config lands.

import { useAppConfig } from "@/hooks/api";
import type { FeatureKey } from "@/types";

/**
 * True unless the admin has explicitly disabled the feature.
 *
 * `fallback` is what the hook returns while /config is loading, failed, or
 * comes from a backend that does not know the key. It defaults to `true`
 * (fail open) for the long-standing flags; a feature that ships disabled by
 * default (e.g. `exam_prep`) passes `false` so it never flashes on.
 */
export function useFeature(key: FeatureKey, fallback = true): boolean {
  const { data } = useAppConfig();
  return data?.features?.[key] ?? fallback;
}
