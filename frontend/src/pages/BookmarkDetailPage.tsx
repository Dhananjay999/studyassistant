import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MessageSquare,
  NotebookPen,
  Play,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Seo } from "@/components/common/Seo";
import { GlassCard } from "@/components/common/GlassCard";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { getBookmark, getQuiz } from "@/lib/api";
import { useCreateSession } from "@/hooks/api";
import type { BookmarkType, ChatSeed, QuizContent } from "@/types";

const TYPE_META: Record<
  BookmarkType,
  { label: string; icon: typeof FileText }
> = {
  response: { label: "Response", icon: MessageSquare },
  quiz: { label: "Quiz", icon: ListChecks },
  flashcard: { label: "Flashcards", icon: Layers },
  media: { label: "Media", icon: FileText },
  note: { label: "Note", icon: NotebookPen },
};

export default function BookmarkDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const createSession = useCreateSession();
  const [quiz, setQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);

  const { data: bookmark, isLoading } = useQuery({
    queryKey: ["bookmark", id],
    queryFn: () => getBookmark(id),
    enabled: Boolean(id),
  });

  const resume = async (mode: ChatSeed["mode"]) => {
    if (!bookmark) return;
    const seed: ChatSeed = {
      mode,
      content: bookmark.content || bookmark.title,
      title: bookmark.title,
    };
    const session = await createSession.mutateAsync({});
    navigate(`/chat?sessionId=${session.id}`, { state: { seed } });
  };

  const startQuiz = async () => {
    if (!bookmark?.item_ref) return;
    try {
      const q = await getQuiz(bookmark.item_ref);
      setQuiz(q);
      setQuizOpen(true);
    } catch {
      // ignore — quiz may have been deleted
    }
  };

  if (isLoading) {
    return (
      <div className="grid h-dvh place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!bookmark) {
    return (
      <div className="grid h-dvh place-items-center bg-background text-center">
        <div>
          <p className="font-medium">Bookmark not found</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => navigate("/bookmarks")}
          >
            Back to bookmarks
          </Button>
        </div>
      </div>
    );
  }

  const meta = TYPE_META[bookmark.item_type];
  const Icon = meta.icon;
  const busy = createSession.isPending;

  return (
    <>
      <Seo title="Saved content — Aeva" noindex path="/bookmarks" />
      <div className="mx-auto min-h-dvh max-w-3xl bg-background px-4 py-4">
        <header className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/bookmarks")}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="gap-1">
            <Icon className="h-3 w-3" /> {meta.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Saved {new Date(bookmark.created_at).toLocaleDateString()}
          </span>
        </header>

        <h1 className="mb-3 font-display text-2xl font-bold">
          {bookmark.title || "Saved content"}
        </h1>

        <GlassCard className="p-5">
          {bookmark.item_type === "quiz" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {bookmark.content || "A saved quiz."}
              </p>
              {bookmark.item_ref && (
                <Button onClick={startQuiz} className="gap-2">
                  <Play className="h-4 w-4" /> Start Quiz
                </Button>
              )}
            </div>
          ) : bookmark.item_type === "flashcard" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {bookmark.content || "A saved flashcard set."}
              </p>
              {bookmark.item_ref && (
                <Button
                  onClick={() => setCardsOpen(true)}
                  className="gap-2 bg-brand-gradient text-white"
                >
                  <GraduationCap className="h-4 w-4" /> Study Flashcards
                </Button>
              )}
            </div>
          ) : (
            <div className="learning-content prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>
                {bookmark.content || "_No content saved._"}
              </ReactMarkdown>
            </div>
          )}
        </GlassCard>

        {/* Continue learning — branch into a fresh session with this as context */}
        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold">Continue learning</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => resume("continue")}
              disabled={busy}
              className="gap-2 bg-brand-gradient text-white"
            >
              <Sparkles className="h-4 w-4" /> Continue Learning
            </Button>
            <Button
              variant="outline"
              onClick={() => resume("followup")}
              disabled={busy}
              className="gap-2"
            >
              <MessageCircleQuestion className="h-4 w-4" /> Ask Follow-up
            </Button>
            <Button
              variant="outline"
              onClick={() => resume("quiz")}
              disabled={busy}
              className="gap-2"
            >
              <ListChecks className="h-4 w-4" /> Create Quiz
            </Button>
          </div>
        </div>
      </div>

      <QuizDrawer quiz={quiz} open={quizOpen} onOpenChange={setQuizOpen} />
      <FlashcardViewer
        setId={bookmark.item_type === "flashcard" ? bookmark.item_ref : null}
        open={cardsOpen}
        onOpenChange={setCardsOpen}
      />
    </>
  );
}
