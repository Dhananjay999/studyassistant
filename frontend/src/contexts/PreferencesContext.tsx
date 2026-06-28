import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Appearance preferences that aren't covered by the theme (which `next-themes`
 * owns). Persisted to localStorage and applied to <html> as a data attribute /
 * class so plain CSS in index.css can react without re-rendering the tree.
 *
 * `compact` is wired through for the UI but not yet applied — it ships as a
 * "coming soon" toggle, so the type lives here to keep the surface stable.
 */
export type FontSize = "small" | "medium" | "large";

interface Preferences {
  fontSize: FontSize;
  reduceMotion: boolean;
  compact: boolean;
}

interface PreferencesContextValue extends Preferences {
  setFontSize: (size: FontSize) => void;
  setReduceMotion: (on: boolean) => void;
  setCompact: (on: boolean) => void;
  reset: () => void;
}

const DEFAULTS: Preferences = {
  fontSize: "medium",
  reduceMotion: false,
  compact: false,
};

const STORAGE_KEY = "aeva_preferences";

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined,
);

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function apply(prefs: Preferences): void {
  const root = document.documentElement;
  root.dataset.fontSize = prefs.fontSize;
  root.classList.toggle("reduce-motion", prefs.reduceMotion);
  root.classList.toggle("compact", prefs.compact);
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);

  // Apply on mount and whenever any preference changes; persist alongside.
  useEffect(() => {
    apply(prefs);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable (private mode) — keep in-memory state only */
    }
  }, [prefs]);

  const setFontSize = useCallback(
    (fontSize: FontSize) => setPrefs((p) => ({ ...p, fontSize })),
    [],
  );
  const setReduceMotion = useCallback(
    (reduceMotion: boolean) => setPrefs((p) => ({ ...p, reduceMotion })),
    [],
  );
  const setCompact = useCallback(
    (compact: boolean) => setPrefs((p) => ({ ...p, compact })),
    [],
  );
  const reset = useCallback(() => setPrefs(DEFAULTS), []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      ...prefs,
      setFontSize,
      setReduceMotion,
      setCompact,
      reset,
    }),
    [prefs, setFontSize, setReduceMotion, setCompact, reset],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx)
    throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
