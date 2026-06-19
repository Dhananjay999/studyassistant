import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { API_CONFIG } from "@/constants/api";
import { apiService, streamingService } from "@/services";
import { User } from "@/types";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  signInWithGoogle: () => void;
  setSession: (
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ) => Promise<void>;
  logout: () => void;
}

const STORAGE = {
  access: "aeva_access_token",
  refresh: "aeva_refresh_token",
  expires: "aeva_expires_at",
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const refreshTimer = useRef<number>();

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE.access);
    localStorage.removeItem(STORAGE.refresh);
    localStorage.removeItem(STORAGE.expires);
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

  const doRefresh = useCallback(async (): Promise<boolean> => {
    const rt = localStorage.getItem(STORAGE.refresh);
    if (!rt) return false;
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const json = await res.json();
      persist(
        json.data.access_token,
        json.data.refresh_token,
        json.data.expires_in,
      );
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
    const res = await apiService.getMe();
    setUser(res.data);
  }, []);

  useEffect(() => {
    apiService.setTokenGetter(() => tokenRef.current);
    streamingService.setTokenGetter(() => tokenRef.current);

    const init = async () => {
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
        const ok = await doRefresh();
        if (ok) {
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
    };

    init();
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSession = useCallback(
    async (
      accessToken: string,
      refreshToken: string,
      expiresIn: number,
    ) => {
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
    window.location.href = `${API_CONFIG.BASE_URL}/auth/login/google`;
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        loading,
        signInWithGoogle,
        setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
