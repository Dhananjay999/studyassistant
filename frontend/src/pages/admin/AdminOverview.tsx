// Dashboard overview: platform-wide counters as metric tiles.

import {
  BookMarked,
  FileText,
  Files,
  Layers,
  ListChecks,
  MessageSquare,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { StatCard } from "@/components/admin/StatCard";
import { useAdminOverview } from "@/hooks/adminApi";
import type { AdminOverview as Overview } from "@/types/admin";

const TILES: {
  key: keyof Overview;
  label: string;
  icon: typeof Users;
  hint?: string;
}[] = [
  { key: "total_users", label: "Total Users", icon: Users },
  { key: "active_users", label: "Active Users", icon: Zap, hint: "last 7 days" },
  { key: "new_users_today", label: "New Today", icon: UserPlus },
  { key: "total_chats", label: "Total Chats", icon: MessageSquare },
  { key: "total_sessions", label: "Total Sessions", icon: Files },
  { key: "total_messages", label: "Total Messages", icon: MessageSquare },
  { key: "total_quizzes", label: "Total Quizzes", icon: ListChecks },
  { key: "total_flashcard_sets", label: "Flashcard Sets", icon: Layers },
  { key: "total_bookmarks", label: "Total Bookmarks", icon: BookMarked },
  { key: "total_files", label: "Uploaded Files", icon: FileText },
];

export function AdminOverview() {
  const { data, isLoading, isError, error } = useAdminOverview();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load stats."}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map((tile, i) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={data?.[tile.key]}
            icon={tile.icon}
            hint={tile.hint}
            loading={isLoading}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}
