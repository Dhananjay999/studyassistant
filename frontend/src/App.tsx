import {
  lazy,
  Suspense,
  useEffect,
  type ElementType,
  type ReactNode,
} from "react";
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
import { ConfirmProvider } from "@/components/common/ConfirmProvider";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useFeature } from "@/hooks/useFeature";
import type { FeatureKey } from "@/types";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import { SigningInModal } from "@/components/auth/SigningInModal";
import { SettingsExperience } from "@/components/settings/SettingsExperience";
import { queryClient } from "@/lib/queryClient";
import { trackPageview } from "@/lib/analytics";
import { isAppMode } from "@/lib/appMode";
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
// The four keep-alive tab pages share a single lazy identity with the mobile
// tab host (see tabPages), so import them from there rather than re-declaring.
import {
  ChatPage,
  QuizzesPage,
  FlashcardsPage,
  BookmarksPage,
} from "@/components/layout/tabPages";
import { useShellViewport } from "@/components/layout/shellViewport";
const BookmarkDetailPage = lazy(() => import("@/pages/BookmarkDetailPage"));
// Study Spaces (opt-in subject workspaces) — lazy: most sessions never leave
// the chat-first flow.
const SpacesPage = lazy(() => import("@/pages/SpacesPage"));
const SpaceWorkspacePage = lazy(() => import("@/pages/SpaceWorkspacePage"));
// AI Notes (editable markdown saved from answers).
const NotesPage = lazy(() => import("@/pages/NotesPage"));
const NoteEditorPage = lazy(() => import("@/pages/NoteEditorPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const RevisionPage = lazy(() => import("@/pages/RevisionPage"));
const FilesPage = lazy(() => import("@/pages/FilesPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const ProfileSectionPage = lazy(() => import("@/pages/ProfileSectionPage"));
// Public, no-login share surface for every shareable content type.
const SharePage = lazy(() => import("@/pages/SharePage"));
// Native-app (WebView) entry: onboarding + welcome/login instead of the
// marketing landing page.
const AppWelcomePage = lazy(() => import("@/pages/AppWelcomePage"));
// Hidden Super Admin panel. The path is an unguessable secret AND the panel
// has its own server-verified auth — the URL is never trusted on its own.
const AdminApp = lazy(() => import("@/pages/admin/AdminApp"));
const ADMIN_ROUTE = "/admin/0670246c/no-access/b7bb2c4485f1/82cacc27d7";

function RouteFallback() {
  return <AppLoader />;
}

/**
 * A keep-alive tab route. On mobile the page is owned by `MobileTabsHost`
 * (mounted once, kept alive), so the route renders `null` to avoid a second
 * mount. On desktop it renders the page normally through the Outlet. Both read
 * the same `useShellViewport()` value, so exactly one instance ever mounts.
 */
function TabRoute({ Component }: { Component: ElementType }) {
  const { isMobileShell } = useShellViewport();
  return isMobileShell ? null : <Component />;
}

/** Reports SPA route changes to GA4 (no-op unless configured). */
function AnalyticsTracker() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trackPageview(pathname + search);
  }, [pathname, search]);
  return null;
}

/** Redirects to /chat when the admin has disabled the route's feature, so
 * deep-links to hidden features degrade gracefully instead of 404ing. */
function FeatureRoute({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  const enabled = useFeature(feature);
  return enabled ? <>{children}</> : <Navigate to="/chat" replace />;
}

function HomeRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (isAuthenticated) return <Navigate to="/chat" replace />;
  // Inside the native app's WebView, skip the marketing site entirely and
  // open the app-style onboarding/welcome experience.
  if (isAppMode()) return <AppWelcomePage />;
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
                  <ConfirmProvider>
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
                    {/* One stable public share URL for every content type
                       (no auth, no app shell). Legacy paths from the
                       pre-generic system render the same page. */}
                    <Route path="/share/:shareId" element={<SharePage />} />
                    <Route
                      path="/quiz/share/:shareId"
                      element={<SharePage />}
                    />
                    <Route
                      path="/quiz/result/:shareId"
                      element={<SharePage />}
                    />
                    {/* Persistent app shell: header + sidebar mount once; only
                       the routed content below swaps (with a crossfade). */}
                    <Route
                      element={
                        <ProtectedRoute>
                          <AppLayout />
                        </ProtectedRoute>
                      }
                    >
                      <Route
                        path="/chat"
                        element={<TabRoute Component={ChatPage} />}
                      />
                      <Route
                        path="/bookmarks"
                        element={<TabRoute Component={BookmarksPage} />}
                      />
                      <Route
                        path="/bookmarks/:id"
                        element={<BookmarkDetailPage />}
                      />
                      <Route
                        path="/quizzes"
                        element={<TabRoute Component={QuizzesPage} />}
                      />
                      <Route
                        path="/flashcards"
                        element={<TabRoute Component={FlashcardsPage} />}
                      />
                      <Route
                        path="/spaces"
                        element={
                          <FeatureRoute feature="study_spaces">
                            <SpacesPage />
                          </FeatureRoute>
                        }
                      />
                      <Route
                        path="/spaces/:spaceId"
                        element={
                          <FeatureRoute feature="study_spaces">
                            <SpaceWorkspacePage />
                          </FeatureRoute>
                        }
                      />
                      <Route
                        path="/notes"
                        element={
                          <FeatureRoute feature="notes">
                            <NotesPage />
                          </FeatureRoute>
                        }
                      />
                      <Route
                        path="/notes/:noteId"
                        element={
                          <FeatureRoute feature="notes">
                            <NoteEditorPage />
                          </FeatureRoute>
                        }
                      />
                      <Route
                        path="/analytics"
                        element={
                          <FeatureRoute feature="analytics">
                            <AnalyticsPage />
                          </FeatureRoute>
                        }
                      />
                      <Route
                        path="/revision"
                        element={
                          <FeatureRoute feature="revision_mode">
                            <RevisionPage />
                          </FeatureRoute>
                        }
                      />
                      <Route path="/files" element={<FilesPage />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route
                        path="/profile/:section"
                        element={<ProfileSectionPage />}
                      />
                    </Route>
                    <Route path={ADMIN_ROUTE} element={<AdminApp />} />
                    <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </BrowserRouter>
                  </ConfirmProvider>
                </TooltipProvider>
              </SettingsProvider>
            </AuthProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
