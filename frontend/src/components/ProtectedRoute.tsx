import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppLoader } from "@/components/common/AppLoader";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <AppLoader />;

  if (!isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}
