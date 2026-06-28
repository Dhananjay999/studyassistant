// Full detail for one user: profile, learning profile, counts, tabbed lists
// of their content, a conversation viewer, and all destructive actions.

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookMarked,
  FileText,
  Layers,
  ListChecks,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { SessionDialog } from "@/components/admin/SessionDialog";
import {
  useAdminUser,
  useClearUserResource,
  useDeleteUser,
  useResetLearningProfile,
} from "@/hooks/adminApi";
import { formatBytes, formatDate, formatDateTime } from "@/lib/adminFormat";
import type { AdminUserDetail as Detail, UserResource } from "@/types/admin";

type Pending =
  | { type: "reset" }
  | { type: "clear"; resource: UserResource }
  | { type: "deleteUser" };

export function AdminUserDetail({
  userId,
  onBack,
  onDeleted,
}: {
  userId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { data, isLoading, isError, error } = useAdminUser(userId);
  const reset = useResetLearningProfile();
  const clear = useClearUserResource();
  const del = useDeleteUser();
  const [pending, setPending] = useState<Pending | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  const busy = reset.isPending || clear.isPending || del.isPending;

  const describe = (p: Pending, d: Detail | undefined) => {
    if (p.type === "reset") {
      return {
        title: "Reset learning profile?",
        description:
          "This clears the user's personalization (language, level, " +
          "style, goals) back to the pending state.",
        confirmText: "Reset profile",
        word: undefined as string | undefined,
      };
    }
    if (p.type === "deleteUser") {
      return {
        title: "Delete this user?",
        description:
          "Permanently deletes the user and ALL of their data — chats, " +
          "messages, quizzes, flashcards, bookmarks, and files. This " +
          "cannot be undone.",
        confirmText: "Delete user",
        word: d?.profile.email || "DELETE",
      };
    }
    return {
      title: `Delete all ${p.resource}?`,
      description: `Permanently deletes every ${p.resource} record for this user. This cannot be undone.`,
      confirmText: `Delete ${p.resource}`,
      word: undefined as string | undefined,
    };
  };

  const run = async () => {
    if (!pending) return;
    try {
      if (pending.type === "reset") {
        await reset.mutateAsync(userId);
        toast.success("Learning profile reset");
      } else if (pending.type === "deleteUser") {
        await del.mutateAsync(userId);
        toast.success("User deleted");
        setPending(null);
        onDeleted();
        return;
      } else {
        await clear.mutateAsync({ id: userId, resource: pending.resource });
        toast.success(`Deleted all ${pending.resource}`);
      }
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  if (isLoading) return <DetailSkeleton onBack={onBack} />;
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load user."}
        </p>
      </div>
    );
  }

  const { profile, counts, learning } = {
    profile: data.profile,
    counts: data.counts,
    learning: data.profile.learning_profile,
  };
  const dialog = pending ? describe(pending, data) : null;

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />

      {/* Profile header */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar name={profile.full_name} email={profile.email} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">
              {profile.full_name || "Unnamed user"}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              {profile.email || "—"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary" className="capitalize">
                {profile.login_provider}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {profile.personalization_status}
              </Badge>
              <span className="text-muted-foreground">
                Joined {formatDate(profile.joined_at)}
              </span>
            </div>
          </div>
          <Button
            variant="destructive"
            className="gap-2"
            onClick={() => setPending({ type: "deleteUser" })}
          >
            <Trash2 className="h-4 w-4" />
            Delete user
          </Button>
        </CardContent>
      </Card>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Sessions" value={counts.sessions} />
        <MiniStat label="Messages" value={counts.messages} />
        <MiniStat label="Quizzes" value={counts.quizzes} />
        <MiniStat label="Flashcards" value={counts.flashcards} />
        <MiniStat label="Bookmarks" value={counts.bookmarks} />
        <MiniStat label="Storage" value={formatBytes(data.storage_used)} />
      </div>

      {/* Learning profile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Learning profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Education" value={learning.education_level} />
          <Field label="Language" value={learning.preferred_language} />
          <Field label="Style" value={learning.explanation_style} />
          <Field label="Goal" value={learning.learning_goal} />
          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">Favorite subjects</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {learning.favorite_subjects.length ? (
                learning.favorite_subjects.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content tabs */}
      <Tabs defaultValue="sessions">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sessions">
            Chats ({data.sessions.length})
          </TabsTrigger>
          <TabsTrigger value="quizzes">
            Quizzes ({data.quizzes.length})
          </TabsTrigger>
          <TabsTrigger value="flashcards">
            Flashcards ({data.flashcards.length})
          </TabsTrigger>
          <TabsTrigger value="bookmarks">
            Bookmarks ({data.bookmarks.length})
          </TabsTrigger>
          <TabsTrigger value="files">Files ({data.files.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <ItemList
            empty="No chats."
            items={data.sessions.map((s) => ({
              id: s.id,
              icon: MessageSquare,
              title: s.title || "Untitled chat",
              meta: `${s.mode} · ${formatDateTime(s.updated_at)}`,
              onClick: () => setOpenSession(s.id),
            }))}
          />
        </TabsContent>
        <TabsContent value="quizzes">
          <ItemList
            empty="No quizzes."
            items={data.quizzes.map((q) => ({
              id: q.id,
              icon: ListChecks,
              title: q.title || q.topic,
              meta: `${q.topic} · ${formatDate(q.created_at)}`,
            }))}
          />
        </TabsContent>
        <TabsContent value="flashcards">
          <ItemList
            empty="No flashcard sets."
            items={data.flashcards.map((f) => ({
              id: f.id,
              icon: Layers,
              title: f.title || f.topic,
              meta: `${f.topic} · ${formatDate(f.created_at)}`,
            }))}
          />
        </TabsContent>
        <TabsContent value="bookmarks">
          <ItemList
            empty="No bookmarks."
            items={data.bookmarks.map((b) => ({
              id: b.id,
              icon: BookMarked,
              title: b.title || "Bookmark",
              meta: formatDate(b.created_at),
            }))}
          />
        </TabsContent>
        <TabsContent value="files">
          <ItemList
            empty="No files."
            items={data.files.map((f) => ({
              id: f.id,
              icon: FileText,
              title: f.file_name,
              meta: `${formatBytes(f.size_bytes)} · ${formatDate(f.created_at)}`,
            }))}
          />
        </TabsContent>
      </Tabs>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-destructive">
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setPending({ type: "reset" })}
          >
            <RotateCcw className="h-4 w-4" />
            Reset learning profile
          </Button>
          {(
            ["sessions", "quizzes", "flashcards", "bookmarks", "files"] as const
          ).map((r) => (
            <Button
              key={r}
              variant="outline"
              size="sm"
              className="gap-2 text-destructive hover:text-destructive"
              onClick={() => setPending({ type: "clear", resource: r })}
            >
              <Trash2 className="h-4 w-4" />
              {r === "sessions" ? "chats" : r}
            </Button>
          ))}
        </CardContent>
      </Card>

      {dialog && (
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(o) => !o && setPending(null)}
          title={dialog.title}
          description={dialog.description}
          confirmText={dialog.confirmText}
          confirmWord={dialog.word}
          loading={busy}
          onConfirm={run}
        />
      )}

      <SessionDialog
        sessionId={openSession}
        onClose={() => setOpenSession(null)}
      />
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      Back to users
    </Button>
  );
}

function Avatar({
  name,
  email,
}: {
  name: string | null;
  email: string | null;
}) {
  const seed = (name || email || "?").trim();
  const initials = seed
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
      {initials || "?"}
    </span>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate">{value || "—"}</p>
    </div>
  );
}

interface ListItem {
  id: string;
  icon: typeof MessageSquare;
  title: string;
  meta: string;
  onClick?: () => void;
}

function ItemList({ items, empty }: { items: ListItem[]; empty: string }) {
  if (!items.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
    );
  }
  return (
    <div className="divide-y rounded-lg border bg-background">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            disabled={!it.onClick}
            onClick={it.onClick}
            className="flex w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-accent/50 disabled:cursor-default"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {it.meta}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
