import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getMediaStatus } from "@/lib/api";
import { qk } from "@/hooks/api";
import type { MediaItem } from "@/types";

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

export interface ViewerState {
  url: string;
  fileName?: string;
  page?: number;
}

/** Docked = side-by-side with the chat; fullscreen = takes over the screen. */
export type ViewerMode = "docked" | "fullscreen";

export interface DocumentViewerController {
  /** The value to feed `DocumentViewerContext.Provider`. */
  value: DocumentViewerContextValue;
  /** Currently open document, or null. */
  viewer: ViewerState | null;
  mode: ViewerMode;
  toggleFullscreen: () => void;
  close: () => void;
}

/**
 * Owns the single PDF viewer instance for the app. Citations (in the chat
 * thread) and the media sidebar live in different subtrees, so the owner
 * component (ChatPage) drives it via this controller and hands the value down
 * through the context; anything below can open documents imperatively —
 * including by media id, which it resolves to a signed URL from the media cache
 * or a fresh status fetch. Keeping the state in the owner lets the layout react
 * to it (dock the panel beside the chat, auto-collapse the nav sidebar).
 */
export function useDocumentViewerController(): DocumentViewerController {
  const qc = useQueryClient();
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [mode, setMode] = useState<ViewerMode>("docked");

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

  const close = useCallback(() => setViewer(null), []);
  const toggleFullscreen = useCallback(
    () => setMode((m) => (m === "docked" ? "fullscreen" : "docked")),
    [],
  );

  const value = useMemo(
    () => ({ openDocument, openDocumentByMediaId }),
    [openDocument, openDocumentByMediaId],
  );

  return { value, viewer, mode, toggleFullscreen, close };
}

export { DocumentViewerContext };

export function useDocumentViewer(): DocumentViewerContextValue {
  const ctx = useContext(DocumentViewerContext);
  if (!ctx) {
    throw new Error(
      "useDocumentViewer must be used within a DocumentViewerContext provider",
    );
  }
  return ctx;
}
