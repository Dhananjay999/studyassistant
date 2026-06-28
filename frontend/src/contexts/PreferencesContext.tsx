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
 * Appearance preferences that aren't covered by light/dark (which `next-themes`
 * owns). Persisted to localStorage and applied to <html> as data attributes /
 * classes so plain CSS in index.css can react without re-rendering the tree.
 *
 * - `colorTheme` is an orthogonal accent palette (purple/ocean/…); it layers on
 *   top of light/dark via `[data-theme]` overrides of the CSS color tokens.
 * - `fontSize` + `contentFont` affect ONLY learning content
 *   (`.learning-content`), never navigation or UI chrome.
 * - `compact` is wired through but not yet applied (ships as "coming soon").
 */
export type FontSize = "small" | "medium" | "large";

export type ColorTheme =
  | "default"
  | "ocean"
  | "emerald"
  | "sunset"
  | "gold"
  | "rose";

export type ContentFont =
  | "inter"
  | "poppins"
  | "nunito"
  | "source-sans"
  | "roboto";

interface Preferences {
  colorTheme: ColorTheme;
  fontSize: FontSize;
  contentFont: ContentFont;
  reduceMotion: boolean;
  compact: boolean;
}

interface PreferencesContextValue extends Preferences {
  setColorTheme: (theme: ColorTheme) => void;
  setFontSize: (size: FontSize) => void;
  setContentFont: (font: ContentFont) => void;
  setReduceMotion: (on: boolean) => void;
  setCompact: (on: boolean) => void;
  reset: () => void;
}

const DEFAULTS: Preferences = {
  colorTheme: "default",
  fontSize: "medium",
  contentFont: "inter",
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
  root.dataset.theme = prefs.colorTheme;
  root.dataset.fontSize = prefs.fontSize;
  root.dataset.contentFont = prefs.contentFont;
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

  const setColorTheme = useCallback(
    (colorTheme: ColorTheme) => setPrefs((p) => ({ ...p, colorTheme })),
    [],
  );
  const setFontSize = useCallback(
    (fontSize: FontSize) => setPrefs((p) => ({ ...p, fontSize })),
    [],
  );
  const setContentFont = useCallback(
    (contentFont: ContentFont) => setPrefs((p) => ({ ...p, contentFont })),
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
      setColorTheme,
      setFontSize,
      setContentFont,
      setReduceMotion,
      setCompact,
      reset,
    }),
    [
      prefs,
      setColorTheme,
      setFontSize,
      setContentFont,
      setReduceMotion,
      setCompact,
      reset,
    ],
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
