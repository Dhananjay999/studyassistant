import {
  BarChart3,
  Bookmark,
  FolderOpen,
  FolderTree,
  ListChecks,
  MessageSquare,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Seo } from "@/components/common/Seo";
import {
  useBookmarks,
  useCollections,
  useMedia,
  useQuizzes,
  useSessions,
} from "@/hooks/api";

export default function AnalyticsPage() {
  const sessions = useSessions().data ?? [];
  const quizzes = useQuizzes().data ?? [];
  const bookmarks = useBookmarks().data ?? [];
  const media = useMedia().data ?? [];
  const collections = useCollections().data ?? [];

  const stats = [
    { label: "Chats", value: sessions.length, icon: MessageSquare },
    { label: "Quizzes", value: quizzes.length, icon: ListChecks },
    { label: "Bookmarks", value: bookmarks.length, icon: Bookmark },
    { label: "Files", value: media.length, icon: FolderOpen },
    { label: "Folders", value: collections.length, icon: FolderTree },
  ];

  return (
    <AppShell title="Analytics">
      <Seo title="Analytics — Aeva" noindex path="/analytics" />
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4 text-brand-1" />
          Your learning at a glance
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <GlassCard key={s.label} className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{s.label}</span>
                </div>
                <p className="mt-2 font-display text-3xl font-extrabold">
                  {s.value}
                </p>
              </GlassCard>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
