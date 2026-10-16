// Gives a page the same "open a cited document" behaviour the chat has,
// without ChatPage's docked side panel: citations and source cards below
// this host open the PDF as a full-screen overlay (the phone layout of the
// chat viewer), on any screen size. ChatPage keeps its own controller and
// docking logic; this is for every other page that renders ChatMessages or
// MarkdownContent (Exam Prep topics today).

import { lazy, Suspense, type ReactNode } from "react";
import {
  DocumentViewerContext,
  useDocumentViewerController,
} from "@/contexts/DocumentViewerContext";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

export function DocumentViewerHost({ children }: { children: ReactNode }) {
  const viewer = useDocumentViewerController();
  return (
    <DocumentViewerContext.Provider value={viewer.value}>
      {children}
      {viewer.viewer && (
        <div className="fixed inset-0 z-50 bg-background">
          <Suspense fallback={null}>
            <PDFViewer
              url={viewer.viewer.url}
              fileName={viewer.viewer.fileName}
              initialPage={viewer.viewer.page}
              onClose={viewer.close}
              fullscreen
            />
          </Suspense>
        </div>
      )}
    </DocumentViewerContext.Provider>
  );
}
