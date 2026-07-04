import { lazy, Suspense, useMemo, useState } from "react";
import { FileText, FolderOpen, ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/common/GlassCard";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { Seo } from "@/components/common/Seo";
import { ListToolbar } from "@/components/common/list";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useMedia } from "@/hooks/api";
import { getMediaStatus } from "@/lib/api";
import { useListQuery } from "@/hooks/useListQuery";
import {
  applyListQuery,
  byDateAsc,
  byDateDesc,
  type ListConfig,
} from "@/lib/listQuery";
import { cn } from "@/lib/utils";
import { isMediaReady, type MediaItem } from "@/types";

// A dedicated full-screen document viewer lives on this page only (the chat
// page has its own docked/fullscreen instance via DocumentViewerContext).
const PDFViewer = lazy(() => import("@/components/PDFViewer"));

const isImageMedia = (m: MediaItem) => m.mime_type.startsWith("image/");

/** Sort/filter config for the media library. */
const FILES_CONFIG: ListConfig<MediaItem> = {
  defaultSort: "newest",
  sorts: [
    { value: "newest", label: "Newest", compare: (a, b) => byDateDesc(a.created_at, b.created_at) },
    { value: "oldest", label: "Oldest", compare: (a, b) => byDateAsc(a.created_at, b.created_at) },
    { value: "name", label: "Name (A–Z)", compare: (a, b) => a.file_name.localeCompare(b.file_name) },
    { value: "size", label: "Largest", compare: (a, b) => b.size_bytes - a.size_bytes },
  ],
  filters: [
    {
      id: "type",
      label: "Type",
      kind: "multi",
      options: [
        { value: "pdf", label: "PDFs" },
        { value: "image", label: "Images" },
      ],
      predicate: (m, sel) =>
        sel.includes(isImageMedia(m) ? "image" : "pdf"),
    },
    {
      id: "status",
      label: "Status",
      kind: "multi",
      options: [
        { value: "ready", label: "Ready" },
        { value: "processing", label: "Processing" },
      ],
      predicate: (m, sel) => {
        const ready = isImageMedia(m) || isMediaReady(m);
        return sel.includes(ready ? "ready" : "processing");
      },
    },
  ],
  searchFields: (m) => [m.file_name],
};

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { data: media = [], isLoading } = useMedia();
  const [pdfDoc, setPdfDoc] = useState<{ url: string; fileName: string } | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(
    null,
  );
  const [openingId, setOpeningId] = useState<string | null>(null);

  const listQuery = useListQuery(FILES_CONFIG);
  const filtered = useMemo(
    () => applyListQuery(media, FILES_CONFIG, listQuery.state),
    [media, listQuery.state],
  );

  const openFile = async (m: MediaItem) => {
    const isImage = isImageMedia(m);
    if (!isImage && !isMediaReady(m)) {
      toast.warning("This file is still being processed.");
      return;
    }
    setOpeningId(m.id);
    try {
      // Signed URLs expire (~1h), so always resolve a fresh one on open.
      const fresh = await getMediaStatus(m.id).catch(() => m);
      const url = fresh.signed_url ?? m.signed_url;
      if (!url) {
        toast.error("Couldn't open this file. Please try again.");
        return;
      }
      if (isImage) setLightbox({ url, alt: m.file_name });
      else setPdfDoc({ url, fileName: m.file_name });
    } finally {
      setOpeningId(null);
    }
  };

  const hasFiles = media.length > 0;

  return (
    <PageContainer title="Files">
      <Seo title="Files — Aeva" noindex path="/files" />
      <div className="p-4">
        {hasFiles && (
          <ListToolbar
            className="mb-4"
            config={FILES_CONFIG}
            query={listQuery}
            placeholder="Search files…"
          />
        )}

        {isLoading && media.length === 0 ? (
          <CardGridSkeleton />
        ) : !hasFiles ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <FolderOpen className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No files yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload PDFs or images from a chat to build your library.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-16 text-center">
            <FolderOpen className="mb-3 h-7 w-7 text-muted-foreground" />
            <p className="font-medium">No matching files</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different search or filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((m) => {
              const isImage = m.mime_type.startsWith("image/");
              const ready = isImage || isMediaReady(m);
              return (
                <GlassCard
                  key={m.id}
                  className="group relative overflow-hidden p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => openFile(m)}
                    className="flex w-full flex-col text-left"
                  >
                    {/* Preview / thumbnail */}
                    <div className="relative flex h-32 items-center justify-center overflow-hidden border-b border-border/50 bg-muted/40">
                      {isImage && m.signed_url ? (
                        <img
                          src={m.signed_url}
                          alt={m.file_name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      ) : isImage ? (
                        <ImageIcon className="h-9 w-9 text-muted-foreground" />
                      ) : (
                        <FileText className="h-9 w-9 text-brand-1" />
                      )}
                      <span className="absolute left-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur">
                        {isImage ? "IMG" : "PDF"}
                      </span>
                      {openingId === m.id && (
                        <div className="absolute inset-0 grid place-items-center bg-background/60">
                          <Loader2 className="h-5 w-5 animate-spin text-brand-1" />
                        </div>
                      )}
                    </div>
                    {/* Meta */}
                    <div className="flex items-start gap-2 p-3">
                      <span
                        className={cn(
                          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                          isImage
                            ? "bg-brand-3/10 text-brand-3"
                            : "bg-brand-1/10 text-brand-1",
                        )}
                      >
                        {isImage ? (
                          <ImageIcon className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.file_name}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {prettySize(m.size_bytes)} ·{" "}
                          {new Date(m.created_at).toLocaleDateString()}
                          {m.page_count ? ` · ${m.page_count} pages` : ""}
                        </p>
                        {!ready && (
                          <span className="mt-1 inline-block rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Processing…
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  {/* Bookmark sits outside the open-button so it doesn't trigger it. */}
                  <div className="absolute right-2 top-2 z-10">
                    <BookmarkButton
                      item={{
                        item_type: "media",
                        item_ref: m.id,
                        title: m.file_name,
                        content: m.file_name,
                        metadata: { mime_type: m.mime_type },
                      }}
                    />
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Full-screen PDF viewer (Files page only). */}
      {pdfDoc && (
        <div className="fixed inset-0 z-50">
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-background">
                <Loader2 className="h-6 w-6 animate-spin text-brand-1" />
              </div>
            }
          >
            <PDFViewer
              url={pdfDoc.url}
              fileName={pdfDoc.fileName}
              fullscreen
              onClose={() => setPdfDoc(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Image lightbox. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 text-white"
            onClick={() => setLightbox(null)}
            aria-label="Close preview"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.alt}
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </PageContainer>
  );
}
