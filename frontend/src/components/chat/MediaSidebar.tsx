import { lazy, Suspense, useState } from "react";
import {
  AlertCircle,
  FileText,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookmarkButton } from "@/components/BookmarkButton";
import { cn } from "@/lib/utils";
import { MAX_SELECTED_FILES } from "@/lib/config";
import type { MediaItem, UploadProgress } from "@/types";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaSidebar({
  items,
  uploads,
  selected,
  activeSessionId,
  onToggle,
  onDelete,
  onUpload,
}: {
  items: MediaItem[];
  uploads: UploadProgress[];
  selected: Set<string>;
  activeSessionId: string | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
  onUpload: (files: FileList) => void;
}) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };
  const [previewPdf, setPreviewPdf] = useState<{
    url: string;
    name: string;
  } | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <div>
          <h3 className="font-display text-sm font-semibold">Your materials</h3>
          {items.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {selected.size}/{MAX_SELECTED_FILES} selected for context
            </p>
          )}
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </span>
        </label>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 pr-1">
          {/* In-progress uploads pinned to the top */}
          {uploads.map((u) => (
            <div
              key={u.id}
              className="rounded-xl border border-border/60 bg-card/50 p-2.5"
            >
              <div className="flex items-center gap-2 text-xs">
                {u.status === "error" ? (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-1" />
                )}
                <span className="flex-1 truncate">{u.name}</span>
                <span className="text-muted-foreground">
                  {u.status === "error" ? "Failed" : `${u.progress}%`}
                </span>
              </div>
              {u.status !== "error" && (
                <Progress value={u.progress} className="mt-2 h-1" />
              )}
            </div>
          ))}

          {items.length === 0 && uploads.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No files yet. Upload PDFs or images to ask questions from them.
            </p>
          )}

          {items.map((m) => {
            const isImage = m.mime_type.startsWith("image/");
            const isSelected = selected.has(m.id);
            const inThisChat =
              !!activeSessionId && m.session_id === activeSessionId;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-2 transition-colors",
                  isSelected
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggle(m.id)}
                  aria-label={`Use ${m.file_name}`}
                />
                <button
                  type="button"
                  onClick={() =>
                    isImage
                      ? m.signed_url && setPreviewImage(m.signed_url)
                      : m.signed_url &&
                        setPreviewPdf({ url: m.signed_url, name: m.file_name })
                  }
                  className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted"
                >
                  {isImage && m.signed_url ? (
                    <img
                      src={m.signed_url}
                      alt={m.file_name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : isImage ? (
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{m.file_name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {prettySize(m.size_bytes)}
                    </span>
                    {inThisChat && (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1.5 text-[9px]"
                      >
                        This chat
                      </Badge>
                    )}
                  </div>
                </div>
                <BookmarkButton
                  item={{
                    item_type: "media",
                    item_ref: m.id,
                    title: m.file_name,
                    content: m.file_name,
                    metadata: {
                      mime_type: m.mime_type,
                      storage_path: m.storage_path,
                    },
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleDelete(m.id)}
                  disabled={deletingId === m.id}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Delete file"
                >
                  {deletingId === m.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {previewImage && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="absolute right-4 top-4 text-white"
            onClick={() => setPreviewImage(null)}
            aria-label="Close preview"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}

      {previewPdf && (
        <Suspense fallback={null}>
          <PDFViewer
            url={previewPdf.url}
            fileName={previewPdf.name}
            onClose={() => setPreviewPdf(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
