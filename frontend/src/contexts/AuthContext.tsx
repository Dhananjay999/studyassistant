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
} from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { qk } from "@/hooks/api";
import type { User } from "@/types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
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
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const refreshTimer = useRef<number>();

  const clearSession = useCallback(() => {
    Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

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
      refreshTimer.current = window.setTimeout(doRefresh, ms);
    },
    [doRefresh],
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
    setUser(await getMe());
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

  const logout = useCallback(() => clearSession(), [clearSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
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
