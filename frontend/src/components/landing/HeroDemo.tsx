// Animated product demo for the landing hero: replays a scripted chat with
// Aeva (user turn → thinking → streamed answer → sources → action chips →
// quiz/flashcard previews) using the same visual language as the real chat.
//
// The real chat components can't be imported here: they reach into app-only
// contexts (DocumentViewer, auth, API hooks) and MarkdownContent drags
// react-markdown + KaTeX into the landing bundle. So the cards/chips below are
// self-contained replicas that copy the exact classes of their in-app
// counterparts — keep them in sync when the chat UI changes. ThinkingIndicator
// and GlassCard are pure and reused directly.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Globe,
  GraduationCap,
  HelpCircle,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  ScrollText,
  Send,
  Shuffle,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { cn } from "@/lib/utils";
import {
  DEMO_CONVERSATIONS,
  type DemoActionId,
  type DemoConversation,
  type DemoFlashcards,
  type DemoQuiz,
  type DemoSource,
} from "@/lib/demoConversations";

// Build-time prerender: render the finished conversation statically so the
// static HTML shows a complete, meaningful exchange (no timers on the server).
const IS_SERVER = typeof window === "undefined";

const LAST_DEMO_KEY = "aeva:landing-demo";

/* ------------------------------------------------------------------------ */
/* Demo selection                                                            */
/* ------------------------------------------------------------------------ */

/** Random demo per page load, avoiding the one shown on the previous visit. */
function pickInitialDemo(): number {
  if (IS_SERVER) return 0;
  let avoid = -1;
  try {
    avoid = Number(window.localStorage.getItem(LAST_DEMO_KEY) ?? "-1");
  } catch {
    // Storage unavailable (private mode) — plain random is fine.
  }
  let idx = Math.floor(Math.random() * DEMO_CONVERSATIONS.length);
  if (DEMO_CONVERSATIONS.length > 1 && idx === avoid) {
    idx = (idx + 1) % DEMO_CONVERSATIONS.length;
  }
  rememberDemo(idx);
  return idx;
}

function rememberDemo(idx: number) {
  try {
    window.localStorage.setItem(LAST_DEMO_KEY, String(idx));
  } catch {
    // Best-effort only.
  }
}

/* ------------------------------------------------------------------------ */
/* Mini markdown renderer (bold / italic / inline code / fences / lists)     */
/* ------------------------------------------------------------------------ */

/** Balance dangling `**`, `*` and `` ` `` so mid-stream text renders clean. */
function closeDangling(md: string): string {
  let out = md;
  if (((md.match(/\*\*/g) ?? []).length & 1) === 1) out += "**";
  const noBold = md.replace(/\*\*/g, "");
  if (((noBold.match(/\*/g) ?? []).length & 1) === 1) out += "*";
  const noFence = md.replace(/```/g, "");
  if (((noFence.match(/`/g) ?? []).length & 1) === 1) out += "`";
  return out;
}

function renderInline(text: string): ReactNode {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
}

type DemoBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; code: string };

function parseBlocks(md: string): DemoBlock[] {
  const blocks: DemoBlock[] = [];
  let code: string[] | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", code: code.join("\n") });
        code = null;
      } else {
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const last = blocks.at(-1);
    if (line.startsWith("- ")) {
      if (last?.type === "ul") last.items.push(line.slice(2));
      else blocks.push({ type: "ul", items: [line.slice(2)] });
    } else if (/^\d+\.\s/.test(line)) {
      const item = line.replace(/^\d+\.\s/, "");
      if (last?.type === "ol") last.items.push(item);
      else blocks.push({ type: "ol", items: [item] });
    } else {
      blocks.push({ type: "p", text: line });
    }
  }
  // Still-open fence while streaming: render what we have as a code block.
  if (code) blocks.push({ type: "code", code: code.join("\n") });
  return blocks;
}

function DemoMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(closeDangling(text));
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed sm:text-xs"
            >
              <code>{b.code}</code>
            </pre>
          );
        }
        if (b.type === "ul" || b.type === "ol") {
          const List = b.type === "ul" ? "ul" : "ol";
          return (
            <List
              key={i}
              className={cn(
                "space-y-1 pl-5 marker:text-brand-1",
                b.type === "ul" ? "list-disc" : "list-decimal",
              )}
            >
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{renderInline(b.text)}</p>;
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Sources (replica of SourceCards / DocCitationChip)                        */
/* ------------------------------------------------------------------------ */

function DemoSources({
  sources,
  onNudge,
}: {
  sources: DemoSource[];
  onNudge: () => void;
}) {
  const docs = sources.filter((s) => s.kind === "doc");
  const webs = sources.filter((s) => s.kind === "web");
  return (
    <div className="mt-3 border-t border-border/40 pt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {webs.length === 0 ? (
          <FileText className="h-3.5 w-3.5 text-brand-1" />
        ) : (
          <Globe className="h-3.5 w-3.5 text-brand-1" />
        )}
        <span className="text-xs font-medium">Sources used for this answer</span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {sources.length}
        </Badge>
      </div>

      {docs.length > 0 && (
        <div className="flex snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {docs.map((s, i) => (
            <motion.button
              key={i}
              type="button"
              onClick={onNudge}
              title={s.snippet}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              className="group inline-flex max-w-[230px] shrink-0 snap-start items-center gap-1.5 rounded-full border border-border/70 bg-card/60 py-1 pl-1.5 pr-2.5 text-xs transition-colors hover:border-brand-1/50 hover:bg-card"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-1/10 text-brand-1">
                <FileText className="h-3 w-3" />
              </span>
              <span className="truncate font-medium">{s.title}</span>
              {s.page != null && (
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                  · p.{s.page}
                </span>
              )}
            </motion.button>
          ))}
        </div>
      )}

      {webs.length > 0 && (
        <div className="flex snap-x gap-2 overflow-x-auto pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {webs.map((s, i) => (
            <motion.button
              key={i}
              type="button"
              onClick={onNudge}
              whileHover={{ y: -2 }}
              className="group flex w-[200px] shrink-0 snap-start flex-col gap-1.5 rounded-xl border border-border/60 bg-card/50 p-2.5 text-left transition-colors hover:border-brand-1/40 hover:bg-card"
            >
              <span className="flex items-center gap-1.5">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=64`}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-4 w-4 shrink-0 rounded"
                />
                <span className="truncate text-[11px] font-medium text-muted-foreground">
                  {s.domain}
                </span>
              </span>
              <span className="line-clamp-2 text-xs font-medium leading-snug">
                {s.title}
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Quiz card (replica of QuizCard) + interactive sample question             */
/* ------------------------------------------------------------------------ */

function DemoQuizCard({ quiz }: { quiz: DemoQuiz }) {
  const [open, setOpen] = useState(false);
  const [qIdx, setQIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const q = quiz.questions[qIdx];
  const hasNext = qIdx < quiz.questions.length - 1;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="mt-3 max-w-md"
    >
      <GlassCard className="border-brand-1/20 p-4">
        {!open ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h4 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
                <Sparkles className="h-4 w-4 shrink-0 text-brand-1" />
                {quiz.title}
              </h4>
              {quiz.examLabel ? (
                <Badge className="shrink-0 gap-1 bg-brand-1/15 text-brand-1">
                  <GraduationCap className="h-3 w-3" />
                  {quiz.examLabel}
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  Quiz
                </Badge>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" /> {quiz.count} Questions
              </span>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> ~{quiz.mins} mins
              </span>
              <span className="col-span-2 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />{" "}
                {quiz.difficulty[0].toUpperCase() + quiz.difficulty.slice(1)}{" "}
                difficulty
              </span>
            </div>

            <Button
              variant="brand"
              className="group mt-4 w-full gap-2"
              onClick={() => setOpen(true)}
            >
              Open Quiz
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Question {qIdx + 1} of {quiz.count}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQIdx(0);
                  setPicked(null);
                }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Close preview
              </button>
            </div>
            <p className="mt-2 text-sm font-medium leading-snug">
              {q.question}
            </p>
            <div className="mt-3 space-y-1.5">
              {q.options.map((opt, i) => {
                const isAnswer = i === q.answer;
                const isPicked = picked === i;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={picked !== null}
                    onClick={() => setPicked(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                      picked === null &&
                        "border-border/60 hover:border-brand-1/50 hover:bg-brand-1/[0.04]",
                      picked !== null &&
                        isAnswer &&
                        "border-emerald-500/60 bg-emerald-500/10 font-medium",
                      picked !== null &&
                        isPicked &&
                        !isAnswer &&
                        "border-red-500/60 bg-red-500/10",
                      picked !== null &&
                        !isPicked &&
                        !isAnswer &&
                        "border-border/40 opacity-60",
                    )}
                  >
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-current text-[9px]">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
            <AnimatePresence>
              {picked !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3"
                >
                  <p className="text-xs font-medium">
                    {picked === q.answer
                      ? "✅ Correct! Aeva also explains why after every question."
                      : "❌ Not quite — Aeva walks you through the right answer."}
                  </p>
                  {hasNext ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-8 gap-1.5 rounded-full text-xs"
                      onClick={() => {
                        setQIdx((v) => v + 1);
                        setPicked(null);
                      }}
                    >
                      Next question
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <a
                      href="#top"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-1 hover:underline"
                    >
                      Sign in free for all {quiz.count} questions
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */
/* Flashcard card (replica of FlashcardCard) + interactive flip preview      */
/* ------------------------------------------------------------------------ */

function DemoFlashcardCard({ flashcards }: { flashcards: DemoFlashcards }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = flashcards.cards[idx];

  const go = (dir: 1 | -1) => {
    setFlipped(false);
    setIdx((v) =>
      (v + dir + flashcards.cards.length) % flashcards.cards.length,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="mt-3 max-w-md"
    >
      <GlassCard className="border-brand-1/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
            <Layers className="h-4 w-4 shrink-0 text-brand-1" />
            {flashcards.title}
          </h4>
          <Badge variant="secondary" className="shrink-0">
            Flashcards
          </Badge>
        </div>

        {!open ? (
          <>
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4" /> {flashcards.count} cards ready to
              study
            </div>
            <Button
              className="mt-4 w-full gap-2 bg-brand-gradient text-white"
              onClick={() => setOpen(true)}
            >
              <GraduationCap className="h-4 w-4" /> Study Flashcards
            </Button>
          </>
        ) : (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setFlipped((v) => !v)}
              aria-label={flipped ? "Show question" : "Show answer"}
              className="block h-32 w-full [perspective:1000px]"
            >
              <motion.div
                className="relative h-full w-full [transform-style:preserve-3d]"
                animate={{ rotateY: flipped ? 180 : 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="absolute inset-0 grid place-items-center rounded-xl border border-brand-1/25 bg-card/70 p-3 text-center text-sm font-medium [backface-visibility:hidden]">
                  {card.front}
                </div>
                <div className="absolute inset-0 grid place-items-center rounded-xl border border-brand-1/25 bg-brand-1/[0.06] p-3 text-center text-xs leading-relaxed [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  {card.back}
                </div>
              </motion.div>
            </button>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Tap the card to flip it
            </p>
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous card"
                className="grid h-7 w-7 place-items-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                {idx + 1} / {flashcards.cards.length} preview cards
              </span>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next card"
                className="grid h-7 w-7 place-items-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */
/* Action chips + follow-ups (replica of SuggestedActions)                   */
/* ------------------------------------------------------------------------ */

const ACTION_META: Record<
  DemoActionId,
  { label: string; icon: LucideIcon; highlight: boolean }
> = {
  quiz: { label: "Create Quiz", icon: Sparkles, highlight: true },
  flashcards: { label: "Create Flashcards", icon: Layers, highlight: true },
  summary: { label: "Summarize", icon: FileText, highlight: false },
  simpler: { label: "Explain Simpler", icon: Minimize2, highlight: false },
  detail: { label: "Explain in Detail", icon: Maximize2, highlight: false },
  plan: { label: "Study Plan", icon: ScrollText, highlight: false },
};

const HIGHLIGHT_CHIP = cn(
  "group inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full",
  "border border-brand-1/40 bg-background px-3.5 py-2 text-xs font-semibold",
  "text-foreground transition-all hover:border-brand-1/60",
  "hover:bg-brand-1/[0.04] disabled:opacity-60",
);

const chipContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.04 },
  },
};

const chipItem = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 420, damping: 26 },
  },
};

function AnimatedChipIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <motion.span
      aria-hidden
      className="text-brand-1 transition-transform group-hover:scale-110"
      animate={{ rotate: [0, 14, -10, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <Icon className="h-3.5 w-3.5" />
    </motion.span>
  );
}

function DemoActions({
  demo,
  loadingAction,
  onHighlightAction,
  onNudge,
}: {
  demo: DemoConversation;
  loadingAction: DemoActionId | null;
  onHighlightAction: (id: "quiz" | "flashcards") => void;
  onNudge: () => void;
}) {
  return (
    <div className="mt-3">
      <motion.div
        variants={chipContainer}
        initial={IS_SERVER ? false : "hidden"}
        animate="show"
        className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {demo.actions.map((id) => {
          const meta = ACTION_META[id];
          const Icon = meta.icon;
          const loading = loadingAction === id;

          if (meta.highlight) {
            return (
              <motion.button
                key={id}
                type="button"
                variants={chipItem}
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.97 }}
                disabled={loadingAction !== null}
                className={HIGHLIGHT_CHIP}
                onClick={() => onHighlightAction(id as "quiz" | "flashcards")}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-1" />
                ) : (
                  <AnimatedChipIcon Icon={Icon} />
                )}
                {meta.label}
              </motion.button>
            );
          }

          return (
            <motion.div key={id} variants={chipItem} className="shrink-0 snap-start">
              <motion.div whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.97 }}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-full px-3 text-xs"
                  onClick={onNudge}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </Button>
              </motion.div>
            </motion.div>
          );
        })}
      </motion.div>

      {demo.followups && demo.followups.length > 0 && (
        <motion.div
          variants={chipContainer}
          initial={IS_SERVER ? false : "hidden"}
          animate="show"
          className="mt-2.5 flex flex-col gap-1.5"
        >
          {demo.followups.map((title) => (
            <motion.button
              key={title}
              type="button"
              variants={chipItem}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.99 }}
              onClick={onNudge}
              className={cn(
                "group inline-flex w-full items-center justify-between gap-2",
                "rounded-xl border border-border/60 bg-muted/30 px-3 py-2",
                "text-left text-xs font-medium text-foreground/90",
                "transition-colors hover:border-brand-1/50 hover:bg-accent",
              )}
            >
              <span className="min-w-0 truncate">{title}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand-1" />
            </motion.button>
          ))}
        </motion.div>
      )}

      <div className="mt-2.5 flex items-center gap-1 border-t border-border/40 pt-2">
        <button
          type="button"
          onClick={onNudge}
          aria-label="Bookmark response"
          className="inline-flex h-7 items-center rounded-full px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bookmark className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onNudge}
          aria-label="Copy response"
          className="inline-flex h-7 items-center rounded-full px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* The demo card                                                             */
/* ------------------------------------------------------------------------ */

type Phase = "user" | "thinking" | "streaming" | "extras" | "actions" | "done";
const PHASE_ORDER: Phase[] = [
  "user",
  "thinking",
  "streaming",
  "extras",
  "actions",
  "done",
];

export function HeroDemo() {
  const reduce = useReducedMotion();
  const [demoIdx, setDemoIdx] = useState(pickInitialDemo);
  const [phase, setPhase] = useState<Phase>(IS_SERVER ? "done" : "user");
  const [typed, setTyped] = useState(() =>
    IS_SERVER ? DEMO_CONVERSATIONS[0].answer : "",
  );
  // Cards revealed by clicking the Quiz / Flashcards chips.
  const [revealed, setRevealed] = useState({ quiz: false, flashcards: false });
  const [loadingAction, setLoadingAction] = useState<DemoActionId | null>(null);
  // One-time "this is a demo, sign in" nudge for mock-only interactions.
  const [nudged, setNudged] = useState(false);
  // Once the visitor clicks inside the demo, stop auto-cycling — they're
  // exploring at their own pace.
  const [interacted, setInteracted] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const loadingTimerRef = useRef<number>();

  const demo = DEMO_CONVERSATIONS[demoIdx];
  const at = (p: Phase) => PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(p);

  const switchTo = useCallback((idx: number) => {
    window.clearTimeout(loadingTimerRef.current);
    setDemoIdx(idx);
    rememberDemo(idx);
    setRevealed({ quiz: false, flashcards: false });
    setLoadingAction(null);
    setNudged(false);
    setTyped("");
    setPhase("user");
    pinnedRef.current = true;
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const nextDemo = useCallback(
    () => switchTo((demoIdx + 1) % DEMO_CONVERSATIONS.length),
    [demoIdx, switchTo],
  );

  // ---- phase machine -----------------------------------------------------
  // user → thinking → streaming happen on fixed delays; streaming → extras is
  // driven by the typewriter below; extras → actions → done chain afterwards.
  useEffect(() => {
    if (IS_SERVER || phase !== "user") return;
    if (reduce) {
      // Reduced motion: skip the theatre and show the finished exchange.
      setTyped(demo.answer);
      setPhase("done");
      return;
    }
    const t1 = window.setTimeout(() => setPhase("thinking"), 500);
    return () => window.clearTimeout(t1);
  }, [phase, demo, reduce]);

  useEffect(() => {
    if (phase !== "thinking") return;
    const t = window.setTimeout(() => setPhase("streaming"), 1900);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "streaming") return;
    const answer = demo.answer;
    let i = 0;
    const id = window.setInterval(() => {
      i += 2 + ((i >> 3) % 3); // 2–4 chars per tick ≈ natural token pace
      if (i >= answer.length) {
        window.clearInterval(id);
        setTyped(answer);
        setPhase("extras");
      } else {
        setTyped(answer.slice(0, i));
      }
    }, 24);
    return () => window.clearInterval(id);
  }, [phase, demo]);

  useEffect(() => {
    if (phase !== "extras" && phase !== "actions") return;
    const t = window.setTimeout(
      () => setPhase(phase === "extras" ? "actions" : "done"),
      phase === "extras" ? 700 : 600,
    );
    return () => window.clearTimeout(t);
  }, [phase]);

  // Idle auto-advance keeps the card alive for passive viewers.
  useEffect(() => {
    if (phase !== "done" || reduce || interacted) return;
    const t = window.setTimeout(nextDemo, 9000);
    return () => window.clearTimeout(t);
  }, [phase, reduce, interacted, nextDemo]);

  // Follow the streaming content like the real chat: pinned to the bottom
  // unless the visitor scrolled up to re-read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [typed, phase, revealed, nudged]);

  useEffect(() => () => window.clearTimeout(loadingTimerRef.current), []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  const revealFromChip = (id: "quiz" | "flashcards") => {
    if (revealed[id]) return;
    setLoadingAction(id);
    loadingTimerRef.current = window.setTimeout(() => {
      setLoadingAction(null);
      setRevealed((r) => ({ ...r, [id]: true }));
    }, 900);
  };

  const showQuizCard = (demo.autoQuiz && at("extras")) || revealed.quiz;
  const showFlashcards = revealed.flashcards;

  return (
    <GlassCard
      strong
      aria-label="Interactive StudyAssistant demo"
      className="flex h-[460px] flex-col overflow-hidden text-left shadow-glow-lg sm:h-[500px]"
      onPointerDownCapture={() => setInteracted(true)}
    >
      {/* Header — looks like a live Aeva session */}
      <div className="flex items-center gap-2.5 border-b border-border/40 px-3.5 py-2.5 sm:px-4">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
          <Bot className="h-4 w-4" />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Aeva</p>
          <p className="text-[11px] leading-tight text-muted-foreground">
            Live demo · no sign-in needed
          </p>
        </div>
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
          <AnimatePresence mode="wait">
            <motion.span
              key={demo.id}
              initial={IS_SERVER ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="min-w-0"
            >
              <Badge
                variant="secondary"
                className="block max-w-[130px] truncate text-[10px] sm:max-w-none"
              >
                {demo.category}
              </Badge>
            </motion.span>
          </AnimatePresence>
          <button
            type="button"
            onClick={() => switchTo(demoIdx)}
            aria-label="Replay this demo"
            title="Replay"
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={nextDemo}
            aria-label="Show another example"
            title="Another example"
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:thin] sm:px-4"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={demo.id}
            initial={IS_SERVER ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-4"
          >
            {/* User turn */}
            <motion.div
              initial={IS_SERVER ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-row-reverse gap-2 sm:gap-3"
            >
              <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground sm:grid">
                <User className="h-4 w-4" />
              </span>
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
                {demo.user}
              </div>
            </motion.div>

            {/* Assistant turn */}
            {at("thinking") && (
              <motion.div
                initial={IS_SERVER ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex gap-2 sm:gap-3"
              >
                <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white sm:grid">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="glass min-w-0 max-w-full flex-1 rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed">
                  {phase === "thinking" ? (
                    <ThinkingIndicator hint={demo.hint} />
                  ) : (
                    <>
                      {demo.toolBadge && (
                        <Badge
                          variant="secondary"
                          className="mb-2 gap-1 text-[10px] font-medium"
                        >
                          {demo.toolBadge}
                        </Badge>
                      )}
                      <DemoMarkdown text={typed} />
                      {phase === "streaming" && (
                        <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
                      )}

                      {at("extras") && demo.sources && (
                        <motion.div
                          initial={IS_SERVER ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          <DemoSources
                            sources={demo.sources}
                            onNudge={() => setNudged(true)}
                          />
                        </motion.div>
                      )}

                      {showQuizCard && demo.quiz && (
                        <DemoQuizCard quiz={demo.quiz} />
                      )}
                      {showFlashcards && demo.flashcards && (
                        <DemoFlashcardCard flashcards={demo.flashcards} />
                      )}

                      {at("actions") && (
                        <DemoActions
                          demo={demo}
                          loadingAction={loadingAction}
                          onHighlightAction={revealFromChip}
                          onNudge={() => setNudged(true)}
                        />
                      )}

                      <AnimatePresence>
                        {nudged && (
                          <motion.p
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="mt-2.5 text-xs text-muted-foreground"
                          >
                            ✨ This is a live demo —{" "}
                            <a
                              href="#top"
                              className="font-semibold text-brand-1 hover:underline"
                            >
                              sign in free
                            </a>{" "}
                            to continue with Aeva.
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Demo picker dots */}
      <div className="flex items-center justify-center gap-1.5 pb-1.5">
        {DEMO_CONVERSATIONS.map((d, i) => (
          <button
            key={d.id}
            type="button"
            aria-label={`Show demo: ${d.category}`}
            title={d.category}
            onClick={() => i !== demoIdx && switchTo(i)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === demoIdx
                ? "w-5 bg-brand-1"
                : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60",
            )}
          />
        ))}
      </div>

      {/* Mock composer — tapping it shows the next example */}
      <div className="border-t border-border/40 px-3 pb-3 pt-2 sm:px-4">
        <button
          type="button"
          onClick={nextDemo}
          aria-label="Show another example"
          className="flex w-full items-center gap-2.5 rounded-full border border-border/60 bg-background/60 py-2 pl-4 pr-1.5 text-left transition-colors hover:border-brand-1/40"
        >
          <span className="flex-1 truncate text-sm text-muted-foreground">
            Ask Aeva anything…
          </span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
            <Send className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </GlassCard>
  );
}
