// Admin auth, scoped entirely to the secret admin route. Independent of the
// user `AuthContext`: it owns its own sessionStorage token via `adminApi`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  adminApi,
  getAdminToken,
  setAdminToken,
  setAdminAuthErrorHandler,
} from "@/lib/adminApi";

type AdminStatus = "checking" | "authed" | "anon";

interface AdminAuthValue {
  status: AdminStatus;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>(() =>
    getAdminToken() ? "checking" : "anon",
  );
  const [username, setUsername] = useState<string | null>(null);
  const mounted = useRef(true);

  const logout = useCallback(() => {
    setAdminToken(null);
    setUsername(null);
    setStatus("anon");
  }, []);

  // Any 401 from an admin call logs us out (token expired / revoked).
  useEffect(() => {
    setAdminAuthErrorHandler(() => {
      if (mounted.current) logout();
    });
    return () => {
      mounted.current = false;
      setAdminAuthErrorHandler(() => {});
    };
  }, [logout]);

  // Validate a persisted token on first mount.
  useEffect(() => {
    if (!getAdminToken()) return;
    adminApi
      .verify()
      .then((res) => {
        if (!mounted.current) return;
        setUsername(res.username);
        setStatus("authed");
      })
      .catch(() => {
        if (mounted.current) logout();
      });
  }, [logout]);

  const login = useCallback(
    async (user: string, password: string) => {
      const result = await adminApi.login(user, password);
      setAdminToken(result.token);
      setUsername(result.username);
      setStatus("authed");
    },
    [],
  );

  const value = useMemo(
    () => ({ status, username, login, logout }),
    [status, username, login, logout],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
