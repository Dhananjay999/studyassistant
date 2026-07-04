import { lazy, Suspense, useEffect } from "react";
import { HelmetProvider } from "react-helmet-async";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppLoader } from "@/components/common/AppLoader";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { SigningInModal } from "@/components/auth/SigningInModal";
import { SettingsExperience } from "@/components/settings/SettingsExperience";
import { queryClient } from "@/lib/queryClient";
import { trackPageview } from "@/lib/analytics";
import LandingPage from "@/pages/LandingPage";
import AuthCallback from "@/pages/AuthCallback";
import NotFound from "@/pages/NotFound";
// Public, indexable pages are eager: they're prerendered to static HTML at
// build time, and a lazy chunk would flash a loader over that real content.
// They share almost all of their code with the landing page anyway.
import FeaturesPage from "@/pages/FeaturesPage";
import AboutPage from "@/pages/AboutPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";

// Heavy app (markdown/KaTeX/PDF) is split out of the landing's initial load.
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const BookmarksPage = lazy(() => import("@/pages/BookmarksPage"));
const BookmarkDetailPage = lazy(() => import("@/pages/BookmarkDetailPage"));
const QuizzesPage = lazy(() => import("@/pages/QuizzesPage"));
const FlashcardsPage = lazy(() => import("@/pages/FlashcardsPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
// Hidden Super Admin panel. The path is an unguessable secret AND the panel
// has its own server-verified auth — the URL is never trusted on its own.
const AdminApp = lazy(() => import("@/pages/admin/AdminApp"));
const ADMIN_ROUTE = "/admin/0670246c/no-access/b7bb2c4485f1/82cacc27d7";

function RouteFallback() {
  return <AppLoader />;
}

/** Reports SPA route changes to GA4 (no-op unless configured). */
function AnalyticsTracker() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trackPageview(pathname + search);
  }, [pathname, search]);
  return null;
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
                    <AnalyticsTracker />
                    <Suspense fallback={<RouteFallback />}>
                      <Routes>
                    <Route path="/" element={<HomeRoute />} />
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    {/* Persistent app shell: header + sidebar mount once; only
                       the routed content below swaps (with a crossfade). */}
                    <Route
                      element={
                        <ProtectedRoute>
                          <AppLayout />
                        </ProtectedRoute>
                      }
                    >
                      <Route path="/chat" element={<ChatPage />} />
                      <Route path="/bookmarks" element={<BookmarksPage />} />
                      <Route
                        path="/bookmarks/:id"
                        element={<BookmarkDetailPage />}
                      />
                      <Route path="/quizzes" element={<QuizzesPage />} />
                      <Route path="/flashcards" element={<FlashcardsPage />} />
                      <Route path="/analytics" element={<AnalyticsPage />} />
                      <Route path="/files" element={<FilesPage />} />
                    </Route>
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
