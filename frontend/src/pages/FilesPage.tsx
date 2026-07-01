import { FileText, FolderOpen, ImageIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { Seo } from "@/components/common/Seo";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useMedia } from "@/hooks/api";

function prettySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { data: media = [], isLoading } = useMedia();

  return (
    <AppShell title="Files">
      <Seo title="Files — Aeva" noindex path="/files" />
      <div className="p-4">
        {isLoading && media.length === 0 ? (
          <CardGridSkeleton />
        ) : media.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <FolderOpen className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No files yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Upload PDFs or images from a chat to build your library.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {media.map((m) => {
              const isImage = m.mime_type.startsWith("image/");
              return (
                <GlassCard key={m.id} className="flex items-center gap-3 p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                    {isImage && m.signed_url ? (
                      <img
                        src={m.signed_url}
                        alt={m.file_name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : isImage ? (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.file_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {prettySize(m.size_bytes)} ·{" "}
                      {new Date(m.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <BookmarkButton
                    item={{
                      item_type: "media",
                      item_ref: m.id,
                      title: m.file_name,
                      content: m.file_name,
                      metadata: { mime_type: m.mime_type },
                    }}
                  />
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
