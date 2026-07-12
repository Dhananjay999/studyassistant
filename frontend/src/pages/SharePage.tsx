import type { ComponentType } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppLoader } from "@/components/common/AppLoader";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Seo } from "@/components/common/Seo";
import { Button } from "@/components/ui/button";
import { SharedQuizView } from "@/components/share/SharedQuizView";
import { SharedResultView } from "@/components/share/SharedResultView";
import { resolveShare } from "@/lib/api";
import type {
  QuizContent,
  ResolvedShare,
  SharedQuizResultContent,
} from "@/types";

/**
 * The one public share surface: /share/{shareId} for EVERY shareable content
 * type. The backend resolves the share into a normalized envelope; this page
 * looks up the renderer for its `content_type`. Supporting a newly shareable
 * feature only needs a renderer registered below.
 */

function QuizRenderer({ share }: { share: ResolvedShare }) {
  const content = share.content as QuizContent;
  // Guests never see the internal quiz UUID; the runner keys submits on the
  // public share id instead.
  const quiz: QuizContent = { ...content, quiz_id: share.share_id };
  return <SharedQuizView shareId={share.share_id} quiz={quiz} />;
}

function QuizResultRenderer({ share }: { share: ResolvedShare }) {
  return (
    <SharedResultView content={share.content as SharedQuizResultContent} />
  );
}

/** content_type → renderer. Extend here for future shareable features. */
const RENDERERS: Record<string, ComponentType<{ share: ResolvedShare }>> = {
  quiz: QuizRenderer,
  quiz_result: QuizResultRenderer,
};

/** Browser-tab title derived from the share's preview metadata. */
function pageTitle(share: ResolvedShare): string {
  const title = typeof share.metadata.title === "string"
    ? share.metadata.title
    : "Shared content";
  if (share.content_type === "quiz_result") {
    const score = Number(share.metadata.score ?? 0);
    return `${Math.round(score)}% on ${title} | StudyAssistant`;
  }
  return `${title} | StudyAssistant`;
}

export default function SharePage() {
  const { shareId = "" } = useParams();
  const navigate = useNavigate();

  const {
    data: share,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["share", shareId],
    queryFn: () => resolveShare(shareId),
    enabled: Boolean(shareId),
    retry: false,
  });

  if (isLoading) return <AppLoader />;

  const Renderer = share ? RENDERERS[share.content_type] : undefined;

  if (isError || !share || !Renderer) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <BrandLogo className="mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold">Nothing here</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This share link is invalid or was removed.
          </p>
          <Button className="mt-5" onClick={() => navigate("/")}>
            Go to StudyAssistant
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-background to-muted/30">
      {/* Crawlers get real OG tags from the backend share URL; this keeps the
          browser tab correct. Shared content stays noindex. */}
      <Seo title={pageTitle(share)} noindex path={`/share/${shareId}`} />

      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border/50 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link to="/" aria-label="StudyAssistant home">
          <BrandLogo />
        </Link>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          Try StudyAssistant
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6">
        <Renderer share={share} />
      </main>
    </div>
  );
}
