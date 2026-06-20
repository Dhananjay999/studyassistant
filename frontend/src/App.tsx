import { lazy, Suspense } from "react";
import { HelmetProvider } from "react-helmet-async";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SigningInModal } from "@/components/auth/SigningInModal";
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

function RouteFallback() {
  return (
    <div className="grid h-dvh place-items-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
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
          <AuthProvider>
            <TooltipProvider delayDuration={200}>
              <Sonner position="top-center" />
              <SigningInModal />
              <BrowserRouter>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<HomeRoute />} />
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
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}
