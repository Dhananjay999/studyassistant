// Full detail for one user: profile, learning profile, counts, tabbed lists
// of their content, a conversation viewer, and all destructive actions.

import { useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowLeft,
  BookMarked,
  Bug,
  FileText,
  Layers,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Pencil,
  RotateCcw,
  Search,
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
  FlashcardDetailDialog,
  MediaDetailDialog,
  ProfileEditDialog,
  QuizDetailDialog,
} from "@/components/admin/InspectDialogs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useAdminTimeline,
  useAdminUser,
  useAdminUserSearch,
  useClearUserResource,
  useDeleteUser,
  useResetLearningProfile,
  useSetDebugUser,
} from "@/hooks/adminApi";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
  const [openQuiz, setOpenQuiz] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [openMedia, setOpenMedia] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const searching = debouncedQuery.trim().length >= 2;
  const userSearch = useAdminUserSearch(userId, debouncedQuery);
  const timeline = useAdminTimeline(userId);
  const setDebug = useSetDebugUser();

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
              <span className="text-muted-foreground">
                ID {profile.id.slice(0, 8)}…
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit profile
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => setPending({ type: "deleteUser" })}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete user
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Bug className="h-3.5 w-3.5" />
              Debug mode
              <Switch
                checked={!!profile.is_debug_user}
                disabled={setDebug.isPending}
                onCheckedChange={(on) =>
                  setDebug.mutate(
                    { id: userId, enabled: on },
                    {
                      onSuccess: () =>
                        toast.success(
                          `Debug mode ${on ? "enabled" : "disabled"}`,
                        ),
                      onError: () => toast.error("Couldn't update debug flag"),
                    },
                  )
                }
              />
            </label>
          </div>
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

      {/* Search everything this user owns */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this user's chats, messages, notes, quizzes, flashcards, files…"
          className="pl-9"
        />
      </div>

      {searching && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {userSearch.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              (
                [
                  ["Chats", userSearch.data?.sessions, MessageSquare,
                    (r: { id: string }) => setOpenSession(r.id)],
                  ["Messages", userSearch.data?.messages, MessageSquare,
                    (r: { session_id?: string }) =>
                      r.session_id && setOpenSession(r.session_id)],
                  ["Notes", userSearch.data?.notes, NotebookPen, undefined],
                  ["Quizzes", userSearch.data?.quizzes, ListChecks,
                    (r: { id: string }) => setOpenQuiz(r.id)],
                  ["Flashcards", userSearch.data?.flashcards, Layers,
                    (r: { id: string }) => setOpenSet(r.id)],
                  ["Files", userSearch.data?.media, FileText,
                    (r: { id: string }) => setOpenMedia(r.id)],
                ] as Array<
                  [
                    string,
                    Array<Record<string, unknown>> | undefined,
                    typeof MessageSquare,
                    ((r: never) => void) | undefined,
                  ]
                >
              ).map(([label, rows, Icon, onOpen]) =>
                rows?.length ? (
                  <div key={label}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <div className="space-y-1">
                      {rows.slice(0, 6).map((r, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled={!onOpen}
                          onClick={() => onOpen?.(r as never)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-default"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            {(r.title as string) ||
                              (r.content as string)?.slice(0, 90) ||
                              (r.file_name as string) ||
                              "—"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )
            )}
            {!userSearch.isLoading &&
              !Object.values(userSearch.data ?? {}).some(
                (v) => Array.isArray(v) && v.length > 0,
              ) && (
                <p className="text-sm text-muted-foreground">
                  No matches for “{debouncedQuery.trim()}”.
                </p>
              )}
          </CardContent>
        </Card>
      )}

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
          <TabsTrigger value="activity" className="gap-1">
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
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
              onClick: () => setOpenQuiz(q.id),
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
              onClick: () => setOpenSet(f.id),
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
              onClick: () => setOpenMedia(f.id),
            }))}
          />
        </TabsContent>
        <TabsContent value="activity">
          {timeline.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !timeline.data?.events.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No activity recorded.
            </p>
          ) : (
            <div className="space-y-1">
              {timeline.data.events.map((e, i) => (
                <button
                  key={`${e.type}-${e.ref}-${i}`}
                  type="button"
                  onClick={() => {
                    if (e.type === "message") setOpenSession(e.ref);
                    else if (
                      e.type === "quiz_created" ||
                      e.type === "quiz_attempt"
                    )
                      setOpenQuiz(e.ref);
                    else if (e.type === "flashcards_created")
                      setOpenSet(e.ref);
                    else if (e.type === "media_uploaded")
                      setOpenMedia(e.ref);
                  }}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className="w-32 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {formatDateTime(e.at)}
                  </span>
                  <span className="min-w-0 truncate">{e.label}</span>
                </button>
              ))}
            </div>
          )}
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
      <QuizDetailDialog quizId={openQuiz} onClose={() => setOpenQuiz(null)} />
      <FlashcardDetailDialog
        setId={openSet}
        onClose={() => setOpenSet(null)}
      />
      <MediaDetailDialog
        mediaId={openMedia}
        onClose={() => setOpenMedia(null)}
      />
      <ProfileEditDialog
        userId={userId}
        profile={profile}
        open={editOpen}
        onClose={() => setEditOpen(false)}
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
