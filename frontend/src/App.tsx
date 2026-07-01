import { lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLoader } from "@/components/common/AppLoader";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SigningInModal } from "@/components/auth/SigningInModal";
import { SettingsExperience } from "@/components/settings/SettingsExperience";
import { queryClient } from "@/lib/queryClient";
import LandingPage from "@/pages/LandingPage";
import AuthCallback from "@/pages/AuthCallback";
import NotFound from "@/pages/NotFound";

// Heavy app (markdown/KaTeX/PDF) is split out of the landing's initial load.
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const BookmarksPage = lazy(() => import("@/pages/BookmarksPage"));
const BookmarkDetailPage = lazy(() => import("@/pages/BookmarkDetailPage"));
const QuizzesPage = lazy(() => import("@/pages/QuizzesPage"));
const FlashcardsPage = lazy(() => import("@/pages/FlashcardsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
// Public, indexable marketing/legal pages (kept out of the landing's initial JS).
const FeaturesPage = lazy(() => import("@/pages/FeaturesPage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
// Hidden Super Admin panel. The path is an unguessable secret AND the panel
// has its own server-verified auth — the URL is never trusted on its own.
const AdminApp = lazy(() => import("@/pages/admin/AdminApp"));
const ADMIN_ROUTE = "/admin/0670246c/no-access/b7bb2c4485f1/82cacc27d7";

function RouteFallback() {
  return <AppLoader />;
}

function HomeRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (isAuthenticated) return <Navigate to="/chat" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <PreferencesProvider>
            <AuthProvider>
              <SettingsProvider>
                <TooltipProvider delayDuration={200}>
                  <Sonner position="top-center" />
                  <SigningInModal />
                  <SettingsExperience />
                  <BrowserRouter>
                    <Suspense fallback={<RouteFallback />}>
                      <Routes>
                    <Route path="/" element={<HomeRoute />} />
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route
                      path="/chat"
                      element={
                        <ProtectedRoute>
                          <ChatPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/bookmarks"
                      element={
                        <ProtectedRoute>
                          <BookmarksPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/bookmarks/:id"
                      element={
                        <ProtectedRoute>
                          <BookmarkDetailPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/quizzes"
                      element={
                        <ProtectedRoute>
                          <QuizzesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/flashcards"
                      element={
                        <ProtectedRoute>
                          <FlashcardsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/analytics"
                      element={
                        <ProtectedRoute>
                          <AnalyticsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/files"
                      element={
                        <ProtectedRoute>
                          <FilesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path={ADMIN_ROUTE} element={<AdminApp />} />
                    <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </BrowserRouter>
                </TooltipProvider>
              </SettingsProvider>
            </AuthProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
