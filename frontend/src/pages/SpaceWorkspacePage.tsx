// Study Space workspace: everything about one subject in tabs — chats,
// files, quizzes, flashcards, bookmarks. Read/organize surface for Phase 1;
// items open in their existing full experiences (chat page, quizzes page, …).

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Download,
  FileText,
  Flame,
  ImageIcon,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard } from "@/components/common/GlassCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { Seo } from "@/components/common/Seo";
import {
  SpaceDialog,
  type SpaceFormValues,
} from "@/components/spaces/SpaceDialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  useCreateSession,
  useSearch,
  useSpaceOverview,
  useSpaceStats,
  useUpdateSpace,
} from "@/hooks/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { exportSpaceMarkdown } from "@/lib/api";
import type { ChatSeed } from "@/types";
import { spaceColor, spaceIcon } from "@/lib/spaces";
import { cn } from "@/lib/utils";

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** One clickable row in a content tab. */
function Row({
  icon: Icon,
  title,
  sub,
  onClick,
}: {
  icon: typeof MessageSquare;
  title: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-2.5 text-left transition-colors",
        onClick && "hover:border-brand-1/40 hover:bg-card",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {title}
      </span>
      {sub && (
        <span className="shrink-0 text-xs text-muted-foreground">{sub}</span>
      )}
    </button>
  );
}

function EmptyTab({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-8 text-center">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Grouped in-space search results (rendered in place of the tabs). */
function SpaceSearchResults({
  loading,
  results,
  onOpenSession,
  onOpenMessage,
  onOpenNote,
  onOpenQuiz,
  onOpenFlashcards,
  onOpenFiles,
}: {
  loading: boolean;
  results: import("@/types").SearchResults | undefined;
  onOpenSession: (id: string) => void;
  onOpenMessage: (sessionId: string, messageId: string) => void;
  onOpenNote: (id: string) => void;
  onOpenQuiz: (id: string) => void;
  onOpenFlashcards: (id: string) => void;
  onOpenFiles: () => void;
}) {
  if (loading || !results) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const notes = results.notes ?? [];
  const empty =
    results.sessions.length === 0 &&
    results.messages.length === 0 &&
    notes.length === 0 &&
    results.quizzes.length === 0 &&
    results.flashcards.length === 0 &&
    results.media.length === 0;

  if (empty) {
    return (
      <EmptyTab
        label="No matches in this space"
        hint="Try a different term — chats, notes, quizzes, flashcards and files are all searched."
      />
    );
  }

  const Group = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      {results.sessions.length > 0 && (
        <Group label="Chats">
          {results.sessions.map((s) => (
            <Row
              key={s.id}
              icon={MessageSquare}
              title={s.title}
              onClick={() => onOpenSession(s.id)}
            />
          ))}
        </Group>
      )}
      {results.messages.length > 0 && (
        <Group label="Messages">
          {results.messages.map((m) => (
            <Row
              key={m.id}
              icon={MessageSquare}
              title={m.content.slice(0, 90)}
              sub={m.session_title}
              onClick={() => onOpenMessage(m.session_id, m.id)}
            />
          ))}
        </Group>
      )}
      {notes.length > 0 && (
        <Group label="Notes">
          {notes.map((n) => (
            <Row
              key={n.id}
              icon={NotebookPen}
              title={n.title}
              sub={n.preview.slice(0, 40)}
              onClick={() => onOpenNote(n.id)}
            />
          ))}
        </Group>
      )}
      {results.quizzes.length > 0 && (
        <Group label="Quizzes">
          {results.quizzes.map((q) => (
            <Row
              key={q.id}
              icon={ListChecks}
              title={q.title}
              sub={q.topic}
              onClick={() => onOpenQuiz(q.id)}
            />
          ))}
        </Group>
      )}
      {results.flashcards.length > 0 && (
        <Group label="Flashcards">
          {results.flashcards.map((f) => (
            <Row
              key={f.id}
              icon={Layers}
              title={f.title}
              sub={f.topic}
              onClick={() => onOpenFlashcards(f.id)}
            />
          ))}
        </Group>
      )}
      {results.media.length > 0 && (
        <Group label="Files">
          {results.media.map((m) => (
            <Row
              key={m.id}
              icon={
                m.mime_type.startsWith("image/") ? ImageIcon : FileText
              }
              title={m.file_name}
              onClick={onOpenFiles}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

export default function SpaceWorkspacePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const navigate = useNavigate();
  const overviewQuery = useSpaceOverview(spaceId);
  const createSession = useCreateSession();
  const updateSpace = useUpdateSpace();
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("chats");
  // Stats aggregate several tables — fetch only once Progress is opened.
  const statsQuery = useSpaceStats(spaceId, tab === "progress");
  const stats = statsQuery.data;
  // In-space search: replaces the tabs with grouped results while typing.
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const searching = debouncedQuery.trim().length >= 2;
  const searchResults = useSearch(debouncedQuery, spaceId);
  const [exporting, setExporting] = useState(false);

  const data = overviewQuery.data;
  const space = data?.space;
  const color = spaceColor(space?.color);
  const Icon = spaceIcon(space?.icon);
  const counts = data?.counts ?? {};

  const startChat = () => {
    createSession.mutate(
      { spaceId },
      {
        onSuccess: (s) => navigate(`/chat?sessionId=${s.id}`),
        onError: () => toast.error("Couldn't start a chat"),
      },
    );
  };

  /** Open a fresh chat in this space with an auto-sent instruction. */
  const seedChat = async (autoSend: string) => {
    try {
      const s = await createSession.mutateAsync({ spaceId });
      const seed: ChatSeed = { mode: "followup", content: "", autoSend };
      navigate(`/chat?sessionId=${s.id}`, { state: { seed } });
    } catch {
      toast.error("Couldn't start a chat");
    }
  };

  // Aeva's recommendations — derived from data already on hand (memory
  // digest + counts), so the strip costs no extra requests.
  const recommendations = useMemo(() => {
    if (!data) return [];
    const recs: { key: string; label: string; run: () => void }[] = [];
    const weak = data.space.settings?.memory?.weak_topics ?? [];
    for (const topic of weak.slice(0, 2)) {
      recs.push({
        key: `weak-${topic}`,
        label: `Practice ${topic}`,
        run: () =>
          void seedChat(
            `Create a 10-question practice quiz on ${topic} to help me improve.`,
          ),
      });
    }
    if ((data.counts.quizzes ?? 0) === 0) {
      recs.push({
        key: "first-quiz",
        label: "Generate your first quiz",
        run: () =>
          void seedChat(
            `Create a quiz on ${data.space.subject || data.space.name}.`,
          ),
      });
    }
    if ((data.counts.flashcard_sets ?? 0) > 0) {
      recs.push({
        key: "review-cards",
        label: "Review flashcards",
        run: () => setTab("flashcards"),
      });
    }
    const last = data.sessions[0];
    if (last) {
      recs.push({
        key: "continue",
        label: `Continue “${last.title.slice(0, 30)}”`,
        run: () => navigate(`/chat?sessionId=${last.id}`),
      });
    }
    return recs.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const exportSpace = async () => {
    if (!spaceId || !space) return;
    setExporting(true);
    try {
      const md = await exportSpaceMarkdown(spaceId);
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${space.name.replace(/[^\w -]+/g, "_")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't export the space");
    } finally {
      setExporting(false);
    }
  };

  const submitEdit = (values: SpaceFormValues) => {
    if (!spaceId) return;
    updateSpace.mutate(
      { id: spaceId, patch: values },
      {
        onSuccess: () => setEditOpen(false),
        onError: () => toast.error("Couldn't update the space"),
      },
    );
  };

  return (
    <PageContainer title={space?.name ?? "Study Space"}>
      <Seo title={space?.name ?? "Study Space"} noindex />

      {overviewQuery.isLoading || !space ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-10 w-2/3 rounded-xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Header */}
          <GlassCard className="mb-4 p-4 sm:p-5">
            <div className="flex items-start gap-3.5">
              <button
                type="button"
                onClick={() => navigate("/spaces")}
                aria-label="All spaces"
                className="mt-1 shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span
                className={cn(
                  "grid h-12 w-12 shrink-0 place-items-center rounded-2xl",
                  color.tint,
                  color.text,
                )}
              >
                <Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-xl font-bold leading-tight">
                    {space.name}
                  </h1>
                  {space.subject && (
                    <Badge variant="secondary">{space.subject}</Badge>
                  )}
                </div>
                {space.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {space.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Export space as markdown"
                  title="Export (.md)"
                  disabled={exporting}
                  onClick={exportSpace}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {!space.is_default && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit space"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="brand" className="gap-1.5" onClick={startChat}>
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New chat</span>
                </Button>
              </div>
            </div>
          </GlassCard>

          {/* Aeva's recommendations — only when there's something useful. */}
          {!searching && recommendations.length > 0 && (
            <div className="mb-4 flex snap-x items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                <Lightbulb className="h-3.5 w-3.5 text-brand-1" />
                Next up
              </span>
              {recommendations.map((rec) => (
                <button
                  key={rec.key}
                  type="button"
                  onClick={rec.run}
                  className="shrink-0 snap-start rounded-full border border-brand-1/40 bg-background px-3.5 py-1.5 text-xs font-semibold transition-colors hover:border-brand-1/60 hover:bg-brand-1/[0.04]"
                >
                  {rec.label}
                </button>
              ))}
            </div>
          )}

          {/* In-space search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search everything in ${space.name}…`}
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {searching ? (
            <SpaceSearchResults
              loading={searchResults.isLoading}
              results={searchResults.data}
              onOpenSession={(id) => navigate(`/chat?sessionId=${id}`)}
              onOpenMessage={(sessionId, messageId) =>
                navigate(`/chat?sessionId=${sessionId}`, {
                  state: { highlightMessageId: messageId },
                })
              }
              onOpenNote={(id) => navigate(`/notes/${id}`)}
              onOpenQuiz={(id) => navigate(`/quizzes?quizId=${id}`)}
              onOpenFlashcards={(id) => navigate(`/flashcards?setId=${id}`)}
              onOpenFiles={() => navigate("/files")}
            />
          ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3 h-auto flex-wrap">
              <TabsTrigger value="chats" className="gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Chats {counts.sessions ? `(${counts.sessions})` : ""}
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-1.5">
                <NotebookPen className="h-3.5 w-3.5" />
                Notes {counts.notes ? `(${counts.notes})` : ""}
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Files {counts.media ? `(${counts.media})` : ""}
              </TabsTrigger>
              <TabsTrigger value="quizzes" className="gap-1.5">
                <ListChecks className="h-3.5 w-3.5" />
                Quizzes {counts.quizzes ? `(${counts.quizzes})` : ""}
              </TabsTrigger>
              <TabsTrigger value="flashcards" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Flashcards{" "}
                {counts.flashcard_sets ? `(${counts.flashcard_sets})` : ""}
              </TabsTrigger>
              <TabsTrigger value="bookmarks" className="gap-1.5">
                <Bookmark className="h-3.5 w-3.5" />
                Bookmarks {counts.bookmarks ? `(${counts.bookmarks})` : ""}
              </TabsTrigger>
              <TabsTrigger value="progress" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Progress
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chats" className="space-y-2">
              {data!.sessions.length === 0 ? (
                <EmptyTab
                  label="No chats yet"
                  hint="Start a conversation — Aeva already knows this space's subject."
                />
              ) : (
                data!.sessions.map((s) => (
                  <Row
                    key={s.id}
                    icon={MessageSquare}
                    title={s.title}
                    sub={shortDate(s.updated_at)}
                    onClick={() => navigate(`/chat?sessionId=${s.id}`)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="notes" className="space-y-2">
              {data!.notes.length === 0 ? (
                <EmptyTab
                  label="No notes yet"
                  hint="Save any of Aeva's answers as a note, then edit and study from it."
                />
              ) : (
                data!.notes.map((n) => (
                  <Row
                    key={n.id}
                    icon={NotebookPen}
                    title={n.title}
                    sub={shortDate(n.updated_at)}
                    onClick={() => navigate(`/notes/${n.id}`)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="files" className="space-y-2">
              {data!.media.length === 0 ? (
                <EmptyTab
                  label="No files yet"
                  hint="PDFs and images you upload in this space's chats appear here."
                />
              ) : (
                data!.media.map((m) => (
                  <Row
                    key={m.id}
                    icon={
                      m.mime_type.startsWith("image/") ? ImageIcon : FileText
                    }
                    title={m.file_name}
                    sub={formatBytes(m.size_bytes)}
                    onClick={() => navigate("/files")}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="quizzes" className="space-y-2">
              {data!.quizzes.length === 0 ? (
                <EmptyTab
                  label="No quizzes yet"
                  hint="Generate a quiz from any answer or file in this space."
                />
              ) : (
                data!.quizzes.map((q) => (
                  <Row
                    key={q.id}
                    icon={ListChecks}
                    title={q.title}
                    sub={q.difficulty || shortDate(q.created_at)}
                    onClick={() => navigate("/quizzes")}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="flashcards" className="space-y-2">
              {data!.flashcard_sets.length === 0 ? (
                <EmptyTab
                  label="No flashcards yet"
                  hint="Turn any answer into a deck with the Create Flashcards action."
                />
              ) : (
                data!.flashcard_sets.map((f) => (
                  <Row
                    key={f.id}
                    icon={Layers}
                    title={f.title}
                    sub={shortDate(f.created_at)}
                    onClick={() => navigate("/flashcards")}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="progress">
              {statsQuery.isLoading || !stats ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full rounded-2xl" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Overall progress + streak */}
                  <GlassCard className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          Overall progress
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Engagement and quiz mastery in this space
                        </p>
                      </div>
                      {stats.streak_days > 0 && (
                        <Badge className="gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          <Flame className="h-3.5 w-3.5" />
                          {stats.streak_days} day
                          {stats.streak_days === 1 ? "" : "s"} streak
                        </Badge>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={stats.progress} className="h-2.5" />
                      <span className="shrink-0 font-display text-sm font-bold">
                        {stats.progress}%
                      </span>
                    </div>
                  </GlassCard>

                  {/* Stat tiles */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        ["Questions asked", stats.questions_asked],
                        ["Files uploaded", stats.media_uploaded],
                        ["Notes", stats.notes_count],
                        [
                          "Quizzes completed",
                          `${stats.quizzes_completed}/${stats.quizzes_total}`,
                        ],
                        ["Quiz attempts", stats.attempts],
                        ["Average score", `${stats.average_score}%`],
                        ["Cards reviewed", stats.flashcards_reviewed],
                        ["Active days", stats.active_days],
                      ] as [string, string | number][]
                    ).map(([label, value]) => (
                      <GlassCard key={label} className="p-3.5">
                        <p className="font-display text-xl font-bold leading-tight">
                          {value}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {label}
                        </p>
                      </GlassCard>
                    ))}
                  </div>

                  {/* Weak / strong topics */}
                  {(stats.weak_topics.length > 0 ||
                    stats.strong_topics.length > 0) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <GlassCard className="p-4">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <TrendingDown className="h-4 w-4 text-red-500" />
                          Needs revision
                        </p>
                        {stats.weak_topics.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            No weak topics right now — nice work!
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {stats.weak_topics.map((t) => (
                              <Badge
                                key={t.topic}
                                variant="secondary"
                                className="gap-1 bg-red-500/10 text-red-600 dark:text-red-400"
                              >
                                {t.topic} · {t.score}%
                              </Badge>
                            ))}
                          </div>
                        )}
                      </GlassCard>
                      <GlassCard className="p-4">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                          Strong topics
                        </p>
                        {stats.strong_topics.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Score 80%+ on a quiz to earn a strong topic.
                          </p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {stats.strong_topics.map((t) => (
                              <Badge
                                key={t.topic}
                                variant="secondary"
                                className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              >
                                {t.topic} · {t.score}%
                              </Badge>
                            ))}
                          </div>
                        )}
                      </GlassCard>
                    </div>
                  )}

                  {stats.attempts === 0 && (
                    <p className="text-center text-xs text-muted-foreground">
                      Take a quiz in this space to unlock score and topic
                      insights.
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="bookmarks" className="space-y-2">
              {data!.bookmarks.length === 0 ? (
                <EmptyTab
                  label="No bookmarks yet"
                  hint="Bookmark answers, quizzes and files to pin them here."
                />
              ) : (
                data!.bookmarks.map((b) => (
                  <Row
                    key={b.id}
                    icon={Bookmark}
                    title={b.title || "Bookmark"}
                    sub={shortDate(b.created_at)}
                    onClick={() => navigate(`/bookmarks/${b.id}`)}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
          )}
        </>
      )}

      {space && (
        <SpaceDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title="Edit Study Space"
          submitLabel="Save changes"
          initial={space}
          busy={updateSpace.isPending}
          onSubmit={submitEdit}
        />
      )}
    </PageContainer>
  );
}
