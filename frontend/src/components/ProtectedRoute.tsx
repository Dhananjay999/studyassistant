import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppLoader } from "@/components/common/AppLoader";
import { Seo } from "@/components/common/Seo";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <AppLoader />;

  if (!isAuthenticated) return <Navigate to="/" replace />;

  // Authenticated app is user-specific — never index it. Individual pages can
  // still render their own <Seo> for the title; this guarantees noindex.
  return (
    <>
      <Seo title="StudyAssistant" noindex />
      {children}
    </>
  );
}
