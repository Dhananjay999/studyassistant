import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Bookmark,
  FileText,
  FolderTree,
  Layers,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
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
import { useBookmarks, useCollections, useSearch } from "@/hooks/api";

/**
 * Cmd/Ctrl+F global search. Chats (incl. response/question text), quizzes, and
 * files come from the backend search endpoint; bookmarks and folders are
 * matched client-side. Results update as you type.
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
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  // Debounce keystrokes before hitting the backend.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(t);
  }, [query]);

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

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const hasResults =
    !!results &&
    (results.sessions.length > 0 ||
      results.messages.length > 0 ||
      results.quizzes.length > 0 ||
      results.media.length > 0 ||
      results.flashcards.length > 0);
  const anything =
    hasResults || matchedBookmarks.length > 0 || matchedFolders.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search chats, quizzes, bookmarks, files…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!searching && (
          <CommandGroup heading="Actions">
            <CommandItem
              value="new chat"
              onSelect={() => run(onNewChat)}
              className="gap-2"
            >
              <MessageSquarePlus className="h-4 w-4" /> New chat
            </CommandItem>
            <CommandItem
              value="open bookmarks"
              onSelect={() => run(() => navigate("/bookmarks"))}
              className="gap-2"
            >
              <Bookmark className="h-4 w-4" /> Open bookmarks
            </CommandItem>
            <CommandItem
              value="toggle theme"
              onSelect={() => run(() => setTheme(isDark ? "light" : "dark"))}
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
                onSelect={() => run(() => onSelectSession(s.id))}
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
                onSelect={() => run(() => onSelectSession(m.session_id))}
                className="gap-2"
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs text-muted-foreground">
                    {m.session_title} · {m.role === "user" ? "You" : "Aeva"}
                  </span>
                  <span className="truncate">{m.content}</span>
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
                onSelect={() => run(() => navigate("/quizzes"))}
                className="gap-2"
              >
                <ListChecks className="h-4 w-4 shrink-0" />
                <span className="truncate">{qz.title}</span>
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
                onSelect={() => run(() => navigate("/flashcards"))}
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
                onSelect={() =>
                  run(() =>
                    navigate("/chat", { state: { previewBookmark: b } }),
                  )
                }
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
                onSelect={() => run(() => navigate("/bookmarks"))}
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
                onSelect={() => run(() => navigate("/files"))}
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
