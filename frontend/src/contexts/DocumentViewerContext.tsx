import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { getMediaStatus } from "@/lib/api";
import { qk } from "@/hooks/api";
import type { MediaItem } from "@/types";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

interface OpenDocArgs {
  url: string;
  fileName?: string;
  page?: number;
}

interface DocumentViewerContextValue {
  openDocument: (args: OpenDocArgs) => void;
  /** Resolve a signed URL by media id (cache, else fetch), then open it. */
  openDocumentByMediaId: (mediaId: string, page?: number) => Promise<void>;
}

const DocumentViewerContext = createContext<DocumentViewerContextValue | null>(
  null,
);

interface ViewerState {
  url: string;
  fileName?: string;
  page?: number;
}

/**
 * Owns the single PDF viewer instance for the app. Citations (in the chat
 * thread) and the media sidebar live in different subtrees, so the viewer is
 * hoisted here and opened imperatively — including by media id, which it
 * resolves to a signed URL from the media cache or a fresh status fetch.
 */
export function DocumentViewerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const openDocument = useCallback((args: OpenDocArgs) => {
    setViewer({ url: args.url, fileName: args.fileName, page: args.page });
  }, []);

  const openDocumentByMediaId = useCallback(
    async (mediaId: string, page?: number) => {
      const cached = qc
        .getQueryData<MediaItem[]>(qk.media)
        ?.find((m) => m.id === mediaId);
      let item = cached;
      if (!item?.signed_url) {
        try {
          item = await getMediaStatus(mediaId);
        } catch {
          item = undefined;
        }
      }
      if (item?.signed_url) {
        setViewer({ url: item.signed_url, fileName: item.file_name, page });
      }
    },
    [qc],
  );

  const value = useMemo(
    () => ({ openDocument, openDocumentByMediaId }),
    [openDocument, openDocumentByMediaId],
  );

  return (
    <DocumentViewerContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {viewer && (
          <Suspense fallback={null}>
            <PDFViewer
              url={viewer.url}
              fileName={viewer.fileName}
              initialPage={viewer.page}
              onClose={() => setViewer(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </DocumentViewerContext.Provider>
  );
}

export function useDocumentViewer(): DocumentViewerContextValue {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) {
    throw new Error(
      "useDocumentViewer must be used within a DocumentViewerProvider",
    );
  }
  return ctx;
}
