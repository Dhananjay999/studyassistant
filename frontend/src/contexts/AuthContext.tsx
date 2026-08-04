import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  API_BASE_URL,
  ENDPOINTS,
  getLearningProfile,
  getMe,
  refreshSession,
  setTokenGetter,
  setUnauthorizedHandler,
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { qk } from "@/hooks/api";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Developer Mode: true only for admin-flagged debug users. The single
   * switch every debug-only UI must check — normal users never see debug
   * information. */
  isDebugUser: boolean;
  loading: boolean;
  signingIn: boolean;
  signInWithGoogle: () => void;
  setSession: (
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ) => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AUTH_MESSAGE = "studyassistant-auth";

const STORAGE = {
  access: "aeva_access_token",
  refresh: "aeva_refresh_token",
  expires: "aeva_expires_at",
};

// Per-user device state (pinned sessions, recent searches, last-open chat).
// It survives logout so the same person signing back in finds everything as
// they left it — but it must never leak into a DIFFERENT account, so on login
// the device is stamped with the owner's user id and the state is wiped when
// the id changes. Device-level keys (theme, preferences, app-mode) are
// untouched either way.
const USER_STATE_OWNER_KEY = "aeva_state_owner";
const USER_STATE_KEYS = ["aeva_pinned_sessions", "aeva_recent_searches"];
const USER_SESSION_KEYS = ["aeva_last_session"];

function reconcileUserState(userId: string): void {
  try {
    if (localStorage.getItem(USER_STATE_OWNER_KEY) === userId) return;
    USER_STATE_KEYS.forEach((k) => localStorage.removeItem(k));
    USER_SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
    localStorage.setItem(USER_STATE_OWNER_KEY, userId);
  } catch {
    /* storage unavailable — nothing persisted to reconcile */
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // Only block on "loading" when a stored session might actually resolve —
  // brand-new visitors (and the build-time prerenderer) get the landing page
  // on the very first render instead of a loader frame.
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return Boolean(
        localStorage.getItem(STORAGE.access) ||
          localStorage.getItem(STORAGE.refresh),
      );
    } catch {
      return false;
    }
  });
  const [signingIn, setSigningIn] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const refreshTimer = useRef<number>();

  // True once the initial token restore has settled. Session teardowns that
  // happen *during* boot (dead token found at startup) must clear quietly —
  // a page refresh there would loop forever (boot → 401 → reload → boot).
  const bootDoneRef = useRef(false);

  const clearSession = useCallback(() => {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

  // Full teardown + hard refresh: drop the session and every in-memory trace
  // of the user (keep-alive tabs, query cache, streams), then leave via a
  // hard replace so the page fully reloads onto the landing/welcome screen
  // and the back button can never reach a signed-in view.
  const hardLogout = useCallback(() => {
    clearSession();
    queryClient.clear();
    window.location.replace("/");
  }, [clearSession]);

  // The session became invalid behind the user's back (401 from the API or a
  // failed pre-emptive refresh). After boot, refresh the page like an
  // explicit logout — never leave a signed-out user on a stale page. During
  // boot, just clear state and let the normal render take over.
  const onSessionInvalid = useCallback(() => {
    if (bootDoneRef.current) hardLogout();
    else clearSession();
  }, [hardLogout, clearSession]);

  const doRefresh = useCallback(async (): Promise<boolean> => {
    const rt = localStorage.getItem(STORAGE.refresh);
    if (!rt) return false;
    try {
      const data = await refreshSession(rt);
      persist(data.access_token, data.refresh_token, data.expires_in);
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRefresh = useCallback(
    (expiresAt: number) => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      const ms = Math.max(expiresAt - Date.now() - 60_000, 5_000);
      // If the pre-emptive refresh fails, the token is (or is about to be)
      // expired with no way back — log the user out rather than leave them
      // holding a dead token.
      refreshTimer.current = window.setTimeout(() => {
        void doRefresh().then((ok) => {
          if (!ok) onSessionInvalid();
        });
      }, ms);
    },
    [doRefresh, onSessionInvalid],
  );

  const persist = useCallback(
    (accessToken: string, refreshToken: string, expiresIn: number) => {
      const expiresAt = Date.now() + expiresIn * 1000;
      localStorage.setItem(STORAGE.access, accessToken);
      localStorage.setItem(STORAGE.refresh, refreshToken);
      localStorage.setItem(STORAGE.expires, String(expiresAt));
      tokenRef.current = accessToken;
      setToken(accessToken);
      scheduleRefresh(expiresAt);
    },
    [scheduleRefresh],
  );

  const loadUser = useCallback(async () => {
    const me = await getMe();
    reconcileUserState(me.id);
    setUser(me);
    // Warm the learning profile once at app init so the first chat (and any
    // personalization-aware UI) reads it from cache instead of re-fetching.
    // Fire-and-forget: it must never block or fail user load.
    queryClient
      .prefetchQuery({
        queryKey: qk.learningProfile,
        queryFn: getLearningProfile,
        staleTime: Infinity,
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);

  // Re-fetch the current user (e.g. after onboarding changes the profile),
  // ignoring transient failures so a stale-but-usable session is kept.
  const refreshUser = useCallback(async () => {
    try {
      await loadUser();
    } catch {
      /* keep existing user */
    }
  }, [loadUser]);

  useEffect(() => {
    setTokenGetter(() => tokenRef.current);
    // Any 401 from the API means the token expired/was revoked — log out
    // (with a page refresh once the app is past boot).
    setUnauthorizedHandler(onSessionInvalid);

    (async () => {
      const at = localStorage.getItem(STORAGE.access);
      const expiresAt = Number(localStorage.getItem(STORAGE.expires) || 0);
      if (at && expiresAt > Date.now()) {
        tokenRef.current = at;
        setToken(at);
        scheduleRefresh(expiresAt);
        try {
          await loadUser();
        } catch {
          clearSession();
        }
      } else if (localStorage.getItem(STORAGE.refresh)) {
        if (await doRefresh()) {
          try {
            await loadUser();
          } catch {
            clearSession();
          }
        } else {
          clearSession();
        }
      }
      setLoading(false);
      bootDoneRef.current = true;
    })();

    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSession = useCallback(
    async (accessToken: string, refreshToken: string, expiresIn: number) => {
      setLoading(true);
      persist(accessToken, refreshToken, expiresIn);
      try {
        await loadUser();
      } finally {
        setLoading(false);
      }
    },
    [persist, loadUser],
  );

  const signInWithGoogle = useCallback(() => {
    const url = `${API_BASE_URL}${ENDPOINTS.AUTH_LOGIN_GOOGLE}`;
    const w = 480;
    const h = 660;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      url,
      "studyassistant-auth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );

    // Popup blocked (or mobile) — fall back to a full-page redirect.
    if (!popup) {
      window.location.href = url;
      return;
    }

    setSigningIn(true);

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== AUTH_MESSAGE) return;
      cleanup();
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      setSession(d.access_token, d.refresh_token, d.expires_in).finally(() =>
        setSigningIn(false),
      );
    };

    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        setSigningIn(false);
      }
    }, 600);

    function cleanup() {
      window.clearInterval(poll);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
  }, [setSession]);

  // Explicit sign-out: the same full teardown + page refresh as any other
  // session end. Persisted per-user niceties (pins, recents) deliberately
  // stay: `reconcileUserState` wipes them at next login if the account
  // differs.
  const logout = hardLogout;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isDebugUser: !!user?.is_debug_user,
        loading,
        signingIn,
        signInWithGoogle,
        setSession,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
