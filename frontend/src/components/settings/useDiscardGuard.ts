import { useCallback, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";

/**
 * Discard-guard for the settings shell. Wrap any navigation/close action with
 * `guard(action)`: if a section has unsaved edits (`dirty`), the action is held
 * and `isPrompting` flips so the shell can confirm; otherwise it runs at once.
 */
export function useDiscardGuard() {
  const { dirty, setDirty } = useSettings();
  const [pending, setPending] = useState<(() => void) | null>(null);

  const guard = useCallback(
    (action: () => void) => {
      if (dirty) {
        // Stash the action behind a confirmation (updater form stores the fn).
        setPending(() => action);
      } else {
        action();
      }
    },
    [dirty],
  );

  const confirm = useCallback(() => {
    setDirty(false);
    setPending((action) => {
      action?.();
      return null;
    });
  }, [setDirty]);

  const cancel = useCallback(() => setPending(null), []);

  return { guard, isPrompting: pending !== null, confirm, cancel };
}
