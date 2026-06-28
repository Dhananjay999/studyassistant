// Global search across users and every listable resource. Results are grouped;
// clicking a hit jumps to the owner's detail (or opens a conversation).

import { useEffect, useState, type LucideIcon } from "react";
import {
  BookMarked,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  ListChecks,
  MessageSquare,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { SessionDialog } from "@/components/admin/SessionDialog";
import { useAdminSearch } from "@/hooks/adminApi";
import type { AdminSearchHit, ResourceKey } from "@/types/admin";

type GroupKey = "users" | ResourceKey;

const GROUPS: { key: GroupKey; label: string; icon: LucideIcon }[] = [
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "sessions", label: "Chats & Sessions", icon: MessageSquare },
  { key: "quizzes", label: "Quizzes", icon: ListChecks },
  { key: "flashcards", label: "Flashcards", icon: Layers },
  { key: "bookmarks", label: "Bookmarks", icon: BookMarked },
  { key: "files", label: "Files", icon: FileText },
];

export function AdminSearch({
  onOpenUser,
}: {
  onOpenUser: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [openSession, setOpenSession] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching } = useAdminSearch(q);
  const results = data?.results ?? {};
  const ready = q.trim().length >= 2;
  const totalHits = GROUPS.reduce(
    (sum, g) => sum + (results[g.key]?.length ?? 0),
    0,
  );

  const onHit = (group: GroupKey, hit: AdminSearchHit) => {
    if (group === "users") onOpenUser(hit.id);
    else if (group === "sessions") setOpenSession(hit.id);
    else if (hit.user_id) onOpenUser(hit.user_id);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Search className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search users, emails, chats, quizzes, flashcards…"
          className="pl-9"
        />
      </div>

      {!ready ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Type at least 2 characters to search.
        </p>
      ) : totalHits === 0 && !isFetching ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No matches for “{q}”.
        </p>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((group) => {
            const hits = results[group.key] ?? [];
            if (!hits.length) return null;
            const Icon = group.icon;
            return (
              <div key={group.key}>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {group.label}
                  <span>({hits.length})</span>
                </div>
                <div className="divide-y rounded-lg border bg-background">
                  {hits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => onHit(group.key, hit)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {hit.label}
                        </p>
                        {hit.sublabel && (
                          <p className="truncate text-xs text-muted-foreground">
                            {hit.sublabel}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SessionDialog
        sessionId={openSession}
        onClose={() => setOpenSession(null)}
      />
    </div>
  );
}
