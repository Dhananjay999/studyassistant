// Gate primitive for admin-managed global feature flags (delivered on
// GET /config). Fails OPEN: every registry default is enabled, so rendering
// while /config loads (or fails) matches the common case and avoids nav
// layout pop — a briefly-visible disabled feature self-corrects as soon as
// the config lands.

import { useAppConfig } from "@/hooks/api";
import type { FeatureKey } from "@/types";

/** True unless the admin has explicitly disabled the feature. */
export function useFeature(key: FeatureKey): boolean {
  const { data } = useAppConfig();
  return data?.features?.[key] ?? true;
}
