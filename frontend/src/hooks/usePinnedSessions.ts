import { useCallback, useEffect, useState } from "react";

/**
 * Client-side session pinning, persisted to localStorage.
 *
 * Pinning is a lightweight, per-device preference — it does not need a backend
 * round-trip, so we keep the ordered list of pinned session ids in
 * localStorage. Newly pinned sessions go to the top of the pinned list so the
 * order reflects most-recently-pinned first (a natural ordering until
 * drag-and-drop lands as a future enhancement).
 */
const STORAGE_KEY = "aeva_pinned_sessions";

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function usePinnedSessions() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(read);

  // Keep multiple tabs in sync — a pin in one tab reflects in the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPinnedIds(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((ids: string[]) => {
    setPinnedIds(ids);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* storage full / unavailable — pinning is best-effort */
    }
  }, []);

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  const togglePin = useCallback(
    (id: string) =>
      persist(
        pinnedIds.includes(id)
          ? pinnedIds.filter((x) => x !== id)
          : [id, ...pinnedIds],
      ),
    [pinnedIds, persist],
  );

  return { pinnedIds, isPinned, togglePin };
}
