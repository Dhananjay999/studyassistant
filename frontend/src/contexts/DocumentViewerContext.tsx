import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMediaStatus } from "@/lib/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { qk } from "@/hooks/api";
import { useBackClose } from "@/hooks/useBackClose";
import type { MediaItem } from "@/types";

export type ViewerOpenSource = "thumbnail" | "citation" | "files" | "deeplink";

interface OpenDocArgs {
  url: string;
  fileName?: string;
  page?: number;
  /** Where the open came from (analytics). */
  source?: ViewerOpenSource;
  mediaId?: string;
}

interface DocumentViewerContextValue {
  openDocument: (args: OpenDocArgs) => void;
  /** Resolve a signed URL by media id (cache, else fetch), then open it. */
  openDocumentByMediaId: (
    mediaId: string,
    page?: number,
    source?: ViewerOpenSource,
  ) => Promise<void>;
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
  // Analytics: when the current document was opened and whether fullscreen
  // was used during this viewing.
  const openedAtRef = useRef<number | null>(null);
  const fullscreenUsedRef = useRef(false);

  const trackOpen = useCallback(
    (source: ViewerOpenSource, mediaId?: string, page?: number) => {
      openedAtRef.current = performance.now();
      fullscreenUsedRef.current = false;
      analytics.track(AnalyticsEvent.MEDIA_VIEWER_OPENED, {
        media_id: mediaId,
        source,
        kind: "pdf",
        page,
      });
    },
    [],
  );

  const openDocument = useCallback(
    (args: OpenDocArgs) => {
      trackOpen(args.source ?? "thumbnail", args.mediaId, args.page);
      setViewer({ url: args.url, fileName: args.fileName, page: args.page });
    },
    [trackOpen],
  );

  const openDocumentByMediaId = useCallback(
    async (mediaId: string, page?: number, source: ViewerOpenSource = "citation") => {
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
        trackOpen(source, mediaId, page);
        setViewer({ url: item.signed_url, fileName: item.file_name, page });
      } else {
        // Don't leave the click silently dead — the document couldn't be
        // resolved (deleted, or no signed URL available).
        toast.error("Couldn't open that document");
      }
    },
    [qc, trackOpen],
  );

  const close = useCallback(() => {
    if (openedAtRef.current !== null) {
      analytics.track(AnalyticsEvent.MEDIA_VIEWER_CLOSED, {
        duration_ms: Math.round(performance.now() - openedAtRef.current),
        fullscreen_used: fullscreenUsedRef.current,
      });
      openedAtRef.current = null;
    }
    setViewer(null);
  }, []);
  const toggleFullscreen = useCallback(() => {
    fullscreenUsedRef.current = true;
    setMode((m) => (m === "docked" ? "fullscreen" : "docked"));
  }, []);

  // Back gesture/button returns from the PDF viewer to the chat.
  useBackClose(viewer !== null, close);

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
