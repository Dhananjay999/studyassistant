import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ChatPage from "./pages/ChatPage";
import { useFingerprint } from "@/hooks/use-fingerprint";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { initializeStreamingService, getStreamingService } from "@/services/streamingService";
import { API_CONFIG } from "./constants";

const queryClient = new QueryClient();

const App = () => {
  // Initialize fingerprint ID on app load
  const { isInitialized, fingerprintId } = useFingerprint();

  // Initialize streaming service
  useEffect(() => {
    if (isInitialized && fingerprintId) {
      initializeStreamingService({
        userId: fingerprintId,
        baseUrl: API_CONFIG.BASE_URL
      });
    }
  }, [isInitialized, fingerprintId]);

  // Update streaming service user ID if it changes
  useEffect(() => {
    if (isInitialized && fingerprintId) {
      try {
        const streamingService = getStreamingService();
        streamingService.updateUserId(fingerprintId);
      } catch (error) {
        // Service not initialized yet, will be handled by the initialization effect
      }
    }
  }, [fingerprintId]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/chat" element={<ChatPage />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
