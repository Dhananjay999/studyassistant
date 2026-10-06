// Rich empty-chat home: personal greeting, what was studied recently, and
// Aeva's proactive revision recommendations — the app should feel alive on
// open, not like a blank chatbot. Falls back to the classic EmptyState for
// brand-new users (no revision data yet), on error, and while nothing richer
// can be shown, so non-adopters keep the exact pre-revision home screen.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { EmptyState } from "@/components/chat/EmptyState";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { MemoryHint } from "@/components/chat/MemoryHint";
import { ExamPrepCta } from "@/components/exam/ExamPrepCta";
import { RecommendationCard } from "@/components/revision/RecommendationCard";
import { useAuth } from "@/contexts/AuthContext";
import { useLearningProfile, useRevisionHome } from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { useIsMobile } from "@/hooks/use-mobile";
import { revisionPrompt } from "@/hooks/useRevisionActions";
import { buildSuggestedPrompts, kindOf } from "@/lib/suggestedPrompts";
import type { RevisionRecommendation } from "@/types";

export function WelcomeHome({ onPick }: { onPick: (text: string) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Admin kill switch: with revision mode off, skip the fetch entirely and
  // fall through to the classic EmptyState below.
  const revisionEnabled = useFeature("revision_mode");
  const { data: home, isLoading, isError } = useRevisionHome(revisionEnabled);
  const { data: profile } = useLearningProfile();

  // Exactly three ways in, like the empty state: a flashcard slot, a quiz
  // slot and a third slot that is Exam Prep when the flag is on, else a plain
  // question. A backend recommendation (with its "why") fills the flashcard
  // or quiz slot when there is one; otherwise a suggestion chip does.
  const examPrepOn = useFeature("exam_prep", false);
  // Phones get the three-slot layout; desktop keeps the full list.
  const isMobile = useIsMobile();
  const prompts = useMemo(
    () => buildSuggestedPrompts(profile, 3),
    [profile],
  );
  const chip = (kind: "cards" | "quiz" | "question") =>
    prompts.find((p) => kindOf(p) === kind);

  if (!revisionEnabled) return <EmptyState onPick={onPick} />;

  if (isLoading) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 px-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-muted-foreground/10" />
        <div className="h-4 w-44 animate-pulse rounded bg-muted-foreground/10" />
        <div className="mt-2 flex w-full flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="glass h-16 w-full animate-pulse rounded-xl"
            />
          ))}
        </div>
      </div>
    );
  }

  const rich =
    !isError &&
    home &&
    (home.recommendations.length > 0 ||
      home.yesterday_topics.length > 0 ||
      home.recent_topics.length > 0);

  if (!rich) return <EmptyState onPick={onPick} />;

  const name =
    home.greeting.name || user?.full_name?.split(" ")[0] || null;
  const studied = home.yesterday_topics.length
    ? home.yesterday_topics
    : home.recent_topics;
  const studiedLabel = home.yesterday_topics.length
    ? "Yesterday you studied"
    : "Recently you studied";

  const openRecommendation = (r: RevisionRecommendation) => {
    analytics.track(AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED, {
      kind: "recommendation",
      action: r.action,
    });
    if (r.action === "quiz" && r.quiz_id) {
      navigate(`/quizzes?quizId=${r.quiz_id}`);
    } else if (r.action === "flashcards" && r.set_id) {
      navigate(`/flashcards?setId=${r.set_id}`);
    } else if (r.action === "quiz") {
      onPick(`Create a quiz on ${r.topic}`);
    } else if (r.action === "flashcards") {
      onPick(`Create flashcards on ${r.topic}`);
    } else {
      onPick(revisionPrompt(r.topic));
    }
  };

  return (
    <div className="relative mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-5 px-4 py-6 text-center">
      {/* Same aurora backdrop as EmptyState so the home mood is unchanged. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/2 top-1/4 h-64 w-64 -translate-x-1/2 animate-float rounded-full bg-brand-1/15 blur-3xl" />
        <div className="absolute bottom-10 right-8 h-48 w-48 animate-float-slow rounded-full bg-brand-3/15 blur-3xl" />
        <div className="absolute bottom-16 left-6 h-40 w-40 animate-float rounded-full bg-brand-4/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-gradient font-display text-3xl font-bold">
          👋 Welcome back{name ? `, ${name}` : ""}
        </h2>
        {studied.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {studiedLabel}:{" "}
            <span className="font-medium text-foreground">
              {studied.slice(0, 3).join(", ")}
            </span>
          </p>
        )}
      </motion.div>

      {/* Streak + due-today teaser */}
      {(home.greeting.streak_days > 0 || home.greeting.due_count > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {home.greeting.streak_days > 0 && (
            <span className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
              {home.greeting.streak_days} day streak
            </span>
          )}
          {home.greeting.due_count > 0 && (
            <button
              type="button"
              onClick={() => navigate("/revision")}
              className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-brand-1 transition-colors hover:border-brand-1/40"
            >
              🔥 {home.greeting.due_count} topic
              {home.greeting.due_count === 1 ? "" : "s"} due for revision →
            </button>
          )}
        </motion.div>
      )}

      {/* Desktop: Aeva's recommendations, Exam Prep and two chips. */}
      {!isMobile && (
        <>
          {home.recommendations.length > 0 && (
            <div
              className="flex w-full flex-col gap-2"
              data-analytics-private
              data-analytics-section="chat_recommendations"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recommended for you
              </p>
              {home.recommendations.map((r, i) => (
                <RecommendationCard
                  key={`${r.action}-${r.topic}`}
                  action={r.action}
                  topic={r.topic}
                  reason={r.reason}
                  index={i}
                  onClick={() => openRecommendation(r)}
                />
              ))}
            </div>
          )}
          <ExamPrepCta source="welcome" />
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {prompts.slice(0, 2).map((p, i) => (
              <motion.button
                key={p.text}
                type="button"
                // Fixed name: the prompt text must not become the event name.
                data-analytics-name="Suggested prompt"
                onClick={() => {
                  analytics.track(AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED, {
                    kind: "empty_state",
                  });
                  onPick(p.text);
                }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
              >
                <p.icon className="h-4 w-4 shrink-0 text-brand-1" />
                {p.text}
              </motion.button>
            ))}
          </div>
        </>
      )}

      {/* Phones: three slots — flashcards · quiz · Exam Prep or a question. */}
      {isMobile && (() => {
        const recCards = home.recommendations.find((r) => r.action === "flashcards");
        const recQuiz = home.recommendations.find((r) => r.action === "quiz");
        const slots: { key: string; node: JSX.Element }[] = [];
        const chipNode = (p: NonNullable<ReturnType<typeof chip>>, i: number) => (
          <motion.button
            type="button"
            // Fixed name: the prompt text must not become the event name.
            data-analytics-name="Suggested prompt"
            onClick={() => {
              analytics.track(AnalyticsEvent.CHAT_SUGGESTED_PROMPT_CLICKED, {
                kind: "empty_state",
              });
              onPick(p.text);
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
          >
            <p.icon className="h-4 w-4 shrink-0 text-brand-1" />
            {p.text}
          </motion.button>
        );
        const recNode = (r: RevisionRecommendation, i: number) => (
          <RecommendationCard
            action={r.action}
            topic={r.topic}
            reason={r.reason}
            index={i}
            onClick={() => openRecommendation(r)}
          />
        );
        const cards = chip("cards");
        const quiz = chip("quiz");
        const question = chip("question");
        if (recCards) slots.push({ key: "rec-cards", node: recNode(recCards, 0) });
        else if (cards) slots.push({ key: "chip-cards", node: chipNode(cards, 0) });
        if (recQuiz) slots.push({ key: "rec-quiz", node: recNode(recQuiz, 1) });
        else if (quiz) slots.push({ key: "chip-quiz", node: chipNode(quiz, 1) });
        if (!examPrepOn && question) {
          slots.push({ key: "chip-question", node: chipNode(question, 2) });
        }
        return (
          <div
            className="flex w-full flex-col gap-2"
            data-analytics-private
            data-analytics-section="chat_recommendations"
          >
            {slots.map((slot) => (
              <div key={slot.key}>{slot.node}</div>
            ))}
            {/* Exam Prep takes the third slot (renders nothing when off). */}
            <ExamPrepCta source="welcome" />
          </div>
        );
      })()}

      <MemoryHint />
    </div>
  );
}
