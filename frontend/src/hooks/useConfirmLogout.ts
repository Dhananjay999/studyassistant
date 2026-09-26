// Shared "Log out?" confirmation so every logout entry point (header menu,
// settings, account section) prompts with the same native-style bottom sheet on
// mobile before signing the user out. Pass an optional `before` callback to run
// on confirm (e.g. close the settings overlay) prior to logout. `source` names
// the entry point for analytics.

import { useCallback } from "react";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useAuth } from "@/contexts/AuthContext";
import { analytics, AnalyticsEvent } from "@/lib/analytics";

export function useConfirmLogout(
  source: string,
): (before?: () => void) => Promise<void> {
  const { logout } = useAuth();
  const confirm = useConfirm();

  return useCallback(
    async (before?: () => void) => {
      const ok = await confirm({
        title: "Log out?",
        description:
          "You'll need to sign in again to get back into your study workspace.",
        confirmText: "Log out",
        cancelText: "Stay signed in",
        destructive: true,
      });
      if (ok) {
        before?.();
        // Tracked before logout() so it is attributed to the signed-in user.
        analytics.track(AnalyticsEvent.LOGOUT_COMPLETED, { source });
        logout();
      }
    },
    [confirm, logout, source],
  );
}
