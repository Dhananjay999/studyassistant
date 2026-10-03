import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Bookmark,
  BrainCircuit,
  Clock,
  FileText,
  FolderTree,
  Layers,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
  NotebookPen,
  Sun,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { markdownToPlain } from "@/lib/markdownPreview";
import { useBookmarks, useCollections, useSearch } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFeature } from "@/hooks/useFeature";

const RECENTS_KEY = "aeva_recent_searches";

function loadRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Cmd/Ctrl+F global search. Chats (incl. response/question text), quizzes,
 * flashcards, and files come from the backend search endpoint; bookmarks and
 * folders are matched client-side. Selecting a result navigates straight to it
 * (opening the quiz/flashcard/file and highlighting the matched chat message).
 * On mobile the dialog fills the screen like a native search page.
 */
export function GlobalCommandPalette({
  open,
  onOpenChange,
  onNewChat,
  onSelectSession,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
}) {
  const navigate = useNavigate();
  const revisionEnabled = useFeature("revision_mode");
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>(loadRecents);
  // Debounce keystrokes before hitting the backend.
  const debounced = useDebouncedValue(query, 180);

  // Reset the query each time the palette is reopened.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: results, isFetching } = useSearch(debounced);
  const { data: bookmarks = [] } = useBookmarks();
  const { data: collections = [] } = useCollections();

  const q = debounced.trim().toLowerCase();
  const searching = q.length >= 2;
  const matchedBookmarks = searching
    ? bookmarks
        .filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.content.toLowerCase().includes(q),
        )
        .slice(0, 6)
    : [];
  const matchedFolders = searching
    ? collections.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 5)
    : [];

  // Remember the term behind a chosen result, close, then navigate.
  const remember = (term: string) => {
    const t = term.trim();
    if (t.length < 2) return;
    setRecents((prev) => {
      const next = [
        t,
        ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase()),
      ].slice(0, 6);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  };
  const run = (fn: () => void, action?: string) => {
    if (action) {
      analytics.track(AnalyticsEvent.SEARCH_ACTION_CLICKED, { action });
    }
    onOpenChange(false);
    fn();
  };
  const go = (group: string, fn: () => void) => {
    analytics.track(AnalyticsEvent.SEARCH_RESULT_CLICKED, {
      scope: "global",
      group,
      query_length: query.trim().length,
    });
    remember(query);
    run(fn);
  };

  const hasResults =
    !!results &&
    (results.sessions.length > 0 ||
      results.messages.length > 0 ||
      results.quizzes.length > 0 ||
      results.media.length > 0 ||
      results.flashcards.length > 0 ||
      (results.notes?.length ?? 0) > 0);
  const anything =
    hasResults || matchedBookmarks.length > 0 || matchedFolders.length > 0;

  // One `SEARCH_PERFORMED` per settled query (debounced + results loaded).
  const lastTrackedRef = useRef("");
  useEffect(() => {
    if (!searching || isFetching || !results) return;
    if (lastTrackedRef.current === q) return;
    lastTrackedRef.current = q;
    const group_counts = {
      sessions: results.sessions.length,
      messages: results.messages.length,
      quizzes: results.quizzes.length,
      media: results.media.length,
      flashcards: results.flashcards.length,
      notes: results.notes?.length ?? 0,
      bookmarks: matchedBookmarks.length,
      folders: matchedFolders.length,
    };
    const result_count = Object.values(group_counts).reduce((a, b) => a + b, 0);
    analytics.track(AnalyticsEvent.SEARCH_PERFORMED, {
      scope: "global",
      query_length: q.length,
      result_count,
      has_results: result_count > 0,
      group_counts,
    });
  }, [searching, isFetching, results, q, matchedBookmarks.length, matchedFolders.length]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search chats, quizzes, bookmarks, files…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList
        className="max-sm:max-h-none max-sm:flex-1"
        data-analytics-private
        data-analytics-section="command_palette"
      >
        {!searching && recents.length > 0 && (
          <CommandGroup heading="Recent searches">
            {recents.map((term) => (
              <CommandItem
                key={`recent-${term}`}
                value={`recent ${term}`}
                onSelect={() => setQuery(term)}
                className="gap-2"
              >
                <Clock className="h-4 w-4 shrink-0 opacity-60" />
                <span className="truncate">{term}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!searching && (
          <CommandGroup heading="Actions">
            <CommandItem
              value="new chat"
              onSelect={() => run(onNewChat, "new_chat")}
              className="gap-2"
            >
              <MessageSquarePlus className="h-4 w-4" /> New chat
            </CommandItem>
            {revisionEnabled && (
              <CommandItem
                value="open revision"
                onSelect={() => run(() => navigate("/revision"), "revision")}
                className="gap-2"
              >
                <BrainCircuit className="h-4 w-4" /> Open revision
              </CommandItem>
            )}
            <CommandItem
              value="open bookmarks"
              onSelect={() => run(() => navigate("/bookmarks"), "bookmarks")}
              className="gap-2"
            >
              <Bookmark className="h-4 w-4" /> Open bookmarks
            </CommandItem>
            <CommandItem
              value="toggle theme"
              onSelect={() =>
                run(() => setTheme(isDark ? "light" : "dark"), "theme")
              }
              className="gap-2"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              Toggle theme
            </CommandItem>
          </CommandGroup>
        )}

        {searching && !anything && (
          <CommandEmpty>
            {isFetching ? "Searching…" : "No results found."}
          </CommandEmpty>
        )}

        {searching && (results?.sessions.length || results?.messages.length) ? (
          <CommandGroup heading="Chats">
            {results?.sessions.map((s) => (
              <CommandItem
                key={`s-${s.id}`}
                value={`chat ${s.id} ${s.title}`}
                onSelect={() => go("sessions", () => onSelectSession(s.id))}
                className="gap-2"
              >
                <MessagesSquare className="h-4 w-4 shrink-0" />
                <span className="truncate">{s.title}</span>
              </CommandItem>
            ))}
            {results?.messages.map((m) => (
              <CommandItem
                key={`m-${m.id}`}
                value={`msg ${m.id} ${m.content}`}
                onSelect={() =>
                  go("messages", () =>
                    navigate(`/chat?sessionId=${m.session_id}`, {
                      state: { highlightMessageId: m.id },
                    }),
                  )
                }
                className="gap-2"
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs text-muted-foreground">
                    {m.session_title} · {m.role === "user" ? "You" : "Aeva"}
                  </span>
                  <span className="truncate">
                    {markdownToPlain(m.content, 160)}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {searching && results?.quizzes.length ? (
          <CommandGroup heading="Quizzes">
            {results.quizzes.map((qz) => (
              <CommandItem
                key={`q-${qz.id}`}
                value={`quiz ${qz.id} ${qz.title} ${qz.topic}`}
                onSelect={() =>
                  go("quizzes", () => navigate(`/quizzes?quizId=${qz.id}`))
                }
                className="gap-2"
              >
                <ListChecks className="h-4 w-4 shrink-0" />
                <span className="truncate">{qz.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {searching && results?.notes?.length ? (
          <CommandGroup heading="Notes">
            {results.notes.map((n) => (
              <CommandItem
                key={`n-${n.id}`}
                value={`note ${n.id} ${n.title} ${n.preview}`}
                onSelect={() => go("notes", () => navigate(`/notes/${n.id}`))}
                className="gap-2"
              >
                <NotebookPen className="h-4 w-4 shrink-0" />
                <span className="truncate">{n.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {searching && results?.flashcards.length ? (
          <CommandGroup heading="Flashcards">
            {results.flashcards.map((fc) => (
              <CommandItem
                key={`fc-${fc.id}`}
                value={`flashcards ${fc.id} ${fc.title} ${fc.topic}`}
                onSelect={() =>
                  go("flashcards", () => navigate(`/flashcards?setId=${fc.id}`))
                }
                className="gap-2"
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span className="truncate">{fc.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {matchedBookmarks.length > 0 && (
          <CommandGroup heading="Bookmarks">
            {matchedBookmarks.map((b) => (
              <CommandItem
                key={`b-${b.id}`}
                value={`bookmark ${b.id} ${b.title}`}
                onSelect={() => go("bookmarks", () => navigate(`/bookmarks/${b.id}`))}
                className="gap-2"
              >
                <Bookmark className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {b.title || b.content.slice(0, 60) || "Untitled"}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {matchedFolders.length > 0 && (
          <CommandGroup heading="Folders">
            {matchedFolders.map((c) => (
              <CommandItem
                key={`f-${c.id}`}
                value={`folder ${c.id} ${c.name}`}
                onSelect={() =>
                  go("folders", () => navigate(`/bookmarks?collection=${c.id}`))
                }
                className="gap-2"
              >
                <FolderTree className="h-4 w-4 shrink-0" />
                <span className="truncate">{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {searching && results?.media.length ? (
          <CommandGroup heading="Files">
            {results.media.map((f) => (
              <CommandItem
                key={`file-${f.id}`}
                value={`file ${f.id} ${f.file_name}`}
                onSelect={() => go("files", () => navigate(`/files?fileId=${f.id}`))}
                className="gap-2"
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{f.file_name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
